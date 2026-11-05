import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ConversionDocumentDto {
  @ApiProperty({ example: 'Torg2' })
  family!: string;
  @ApiProperty({ example: '5.01' })
  formatVersion!: string;
  @ApiProperty({ example: 'torg2_05_01_01' })
  operatorVersion!: string;
  @ApiProperty({ example: 0 })
  titleIndex!: number;
  @ApiProperty({ nullable: true, example: null })
  function!: string | null;
  @ApiProperty({ nullable: true, example: null })
  workflowFunction!: string | null;
  @ApiProperty({ example: '1175014' })
  knd!: string;
}

export class ConversionValidationDto {
  @ApiProperty({ example: 'valid' })
  xsd!: string;
  @ApiProperty({ example: 'DP_PRIRASXPRIN_1_994_01_05_01_04' })
  schemaRevision!: string;
  @ApiProperty()
  schemaSha256!: string;
  @ApiProperty({ example: 'torg2-business-v1' })
  businessRulesVersion!: string;
  @ApiProperty({ enum: ['passed', 'passed-with-warnings'], example: 'passed' })
  business!: string;
  @ApiProperty({ example: 0 })
  unmappedCount!: number;
}

export class ConversionWarningDto {
  @ApiProperty()
  code!: string;
  @ApiProperty()
  message!: string;
  @ApiPropertyOptional()
  path?: string;
}

export class ConversionResponseDto {
  @ApiProperty({ format: 'uuid' })
  artifactId!: string;
  @ApiProperty({ example: 'ready' })
  status!: string;
  @ApiProperty({ type: ConversionDocumentDto })
  document!: ConversionDocumentDto;
  @ApiProperty({ type: ConversionValidationDto })
  validation!: ConversionValidationDto;
  @ApiProperty({ description: 'SHA-256 of the exact bytes submitted by the client' })
  sourceSha256!: string;
  @ApiProperty({ description: 'SHA-256 of the stored PDF; this is the byte sequence to sign' })
  pdfSha256!: string;
  @ApiProperty()
  pdfSizeBytes!: number;
  @ApiProperty()
  pageCount!: number;
  @ApiProperty()
  templateVersion!: string;
  @ApiProperty({ example: 'pdf' })
  signingTarget!: string;
  @ApiProperty({ example: 'external-detached' })
  signatureProfile!: string;
  @ApiProperty({ example: 'not-provided' })
  signatureStatus!: string;
  @ApiProperty({ format: 'uri' })
  downloadUrl!: string;
  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;
  @ApiProperty({ type: [ConversionWarningDto] })
  warnings!: ConversionWarningDto[];
}
