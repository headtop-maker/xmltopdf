import { Body, Controller, Get, Header, HttpCode, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../access/api-key.guard';
import { ApiKeyGuard } from '../access/api-key.guard';
import { CurrentPrincipal } from '../access/principal.decorator';
import type { Principal } from '../access/api-key.guard';
import { ConversionsService } from './conversions.service';
import { ConversionResponseDto } from './conversions.dto';
import type { ConversionResult } from './conversion.types';

@ApiTags('conversions')
@Controller('api/v1/conversions')
export class ConversionsController {
  constructor(private readonly conversions: ConversionsService) {}

  @Post()
  @HttpCode(201)
  @UseGuards(ApiKeyGuard)
  @ApiOperation({
    summary: 'Convert a formalized XML document and return metadata with a short-lived download link',
    description:
      'The raw XML document is the request body. The response is JSON: metadata plus a capability link that ' +
      'serves the exact PDF bytes from in-memory cache. Nothing is stored on disk; the link survives only ' +
      'while the process is alive and the cache entry is not evicted.',
  })
  @ApiConsumes('application/octet-stream', 'application/xml', 'text/xml')
  @ApiProduces('application/json')
  @ApiBody({ schema: { type: 'string', format: 'binary' }, description: 'XML document bytes' })
  @ApiResponse({ status: 201, type: ConversionResponseDto, description: 'PDF rendered; download link issued' })
  @ApiResponse({ status: 400, description: 'Empty, malformed, unsafe or undecodable XML' })
  @ApiResponse({ status: 409, description: 'Ambiguous document type' })
  @ApiResponse({ status: 413, description: 'A configured input limit was exceeded' })
  @ApiResponse({ status: 415, description: 'The request body is not XML' })
  @ApiResponse({ status: 422, description: 'Unsupported document or failed validation' })
  async create(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
    @CurrentPrincipal() principal: Principal,
  ): Promise<ConversionResponseDto> {
    const result = await this.conversions.convert({
      ownerId: principal.ownerId,
      body,
      contentType: request.header('content-type'),
    });
    response.status(201);
    response.setHeader('Location', `/api/v1/downloads/${result.downloadUrl.split('/').pop() ?? ''}`);
    return result;
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
    summary: 'Download the exact PDF bytes by short-lived capability token',
    description:
      'The token is a bearer capability backed by in-memory cache. Unknown, expired, evicted or post-restart ' +
      'tokens return the same 404.',
  })
  @ApiParam({
    name: 'token',
    description:
      'Capability token from the POST response (downloadToken, or the last segment of downloadUrl). ' +
      'This is not the artifactId.',
    example: 'eqVhV4LJ2d5QVup-2Zr9ZLr81l4x3-Si9KpYwZAxXDI',
  })
  @ApiProduces('application/pdf')
  @ApiResponse({ status: 200, description: 'Stored PDF bytes' })
  @ApiResponse({ status: 404, description: 'Unknown or expired token' })
  async download(@Param('token') token: string, @Res() response: Response): Promise<void> {
    const { result } = this.conversions.download(token);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Length', String(result.pdf.length));
    response.setHeader('ETag', `"${result.pdfSha256}"`);
    response.setHeader('Content-Disposition', contentDisposition(result));
    response.setHeader('X-Pdf-Sha256', result.pdfSha256);
    response.end(result.pdf);
  }
}

function contentDisposition(result: ConversionResult): string {
  const base = result.document.family === 'Torg2' ? 'torg2' : 'document';
  const name = `${base}-${result.pdfSha256.slice(0, 8)}.pdf`;
  return `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
