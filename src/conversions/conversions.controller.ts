import { Body, Controller, Get, Header, HttpCode, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../access/api-key.guard';
import { ApiKeyGuard } from '../access/api-key.guard';
import { CurrentPrincipal } from '../access/principal.decorator';
import type { Principal } from '../access/api-key.guard';
import { errors } from '../common/errors';
import { sha256Hex } from '../common/hash';
import { ConversionsService } from './conversions.service';
import { ConversionResponseDto } from './conversions.dto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@ApiTags('conversions')
@Controller('api/v1/conversions')
export class ConversionsController {
  constructor(private readonly conversions: ConversionsService) {}

  @Post()
  @HttpCode(201)
  @UseGuards(ApiKeyGuard)
  @ApiOperation({
    summary: 'Convert a formalized XML document into a PDF prepared for external signing',
    description:
      'The raw XML document is the request body. The response is JSON with metadata and a short-lived download URL; ' +
      'it is not a PDF stream. The stored PDF is immutable for the lifetime of the artifact.',
  })
  @ApiConsumes('application/octet-stream', 'application/xml', 'text/xml')
  @ApiProduces('application/json')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'Up to 128 characters; repeats with the same input return the same artifact',
  })
  @ApiBody({ schema: { type: 'string', format: 'binary' }, description: 'XML document bytes' })
  @ApiResponse({ status: 201, type: ConversionResponseDto, description: 'PDF artifact created' })
  @ApiResponse({ status: 400, description: 'Empty, malformed, unsafe or undecodable XML' })
  @ApiResponse({ status: 409, description: 'Ambiguous document type or idempotency conflict' })
  @ApiResponse({ status: 413, description: 'A configured input limit was exceeded' })
  @ApiResponse({ status: 415, description: 'The request body is not XML' })
  @ApiResponse({ status: 422, description: 'Unsupported document or failed validation' })
  async create(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
    @CurrentPrincipal() principal: Principal,
  ): Promise<ConversionResponseDto> {
    const idempotencyKey = request.header('idempotency-key');
    const result = await this.conversions.convert({
      ownerId: principal.ownerId,
      body,
      contentType: request.header('content-type'),
      idempotencyKey: idempotencyKey ?? undefined,
    });
    response.setHeader('Location', `/api/v1/conversions/${result.artifactId}`);
    return result;
  }

  @Get(':artifactId')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({
    summary: 'Read artifact metadata and obtain a fresh short-lived download link',
    description: 'Returns 410 ARTIFACT_EXPIRED for the owner after expiry; other principals receive 404.',
  })
  @ApiResponse({ status: 200, type: ConversionResponseDto })
  @ApiResponse({ status: 404, description: 'Unknown artifact or a different owner' })
  @ApiResponse({ status: 410, description: 'Artifact expired' })
  get(
    @Param('artifactId') artifactId: string,
    @CurrentPrincipal() principal: Principal,
  ): ConversionResponseDto {
    if (!UUID_PATTERN.test(artifactId)) throw errors.notFound('Artifact not found');
    return this.conversions.getById(artifactId, principal.ownerId);
  }
}

@ApiTags('downloads')
@Controller('api/v1/downloads')
export class DownloadsController {
  constructor(private readonly conversions: ConversionsService) {}

  @Get(':token')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiOperation({
    summary: 'Download the exact stored PDF bytes by capability token',
    description:
      'The token is a bearer capability: it is not written to logs and must not be placed in Referer-capable pages.',
  })
  @ApiProduces('application/pdf')
  @ApiResponse({ status: 200, description: 'Stored PDF bytes' })
  @ApiResponse({ status: 404, description: 'Unknown, expired or revoked token' })
  async download(
    @Param('token') token: string,
    @Res() response: Response,
  ): Promise<void> {
    const { artifact, pdf } = await this.conversions.download(token);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Length', String(pdf.length));
    response.setHeader('ETag', `"${sha256Hex(pdf)}"`);
    response.setHeader('Content-Disposition', contentDisposition(artifact));
    response.end(pdf);
  }
}

function contentDisposition(artifact: { document: { family: string }; id: string }): string {
  const base = artifact.document.family === 'Torg2' ? 'torg2' : 'document';
  const name = `${base}-${artifact.id.slice(0, 8)}.pdf`;
  return `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
