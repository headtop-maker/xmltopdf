import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';
import { XsdValidatorService } from '../../src/validation/xsd-validator.service';

const config = loadConfig();
const sample = readFileSync('test/fixtures/torg2.xml');
const updSample = readFileSync('test/fixtures/upd-schfdop.xml');
const updTitle1Sample = readFileSync('test/fixtures/upd-title1.xml');
const torg2Title1Sample = readFileSync('test/fixtures/torg2-title1.xml');
const schemas = {
  torg2Title0: 'resources/schemas/torg2/torg2_05_01_01/DP_PRIRASXPRIN_1_994_01_05_01_04.xsd',
  torg2Title1: 'resources/schemas/torg2/torg2_05_01_01/DP_PRIRASXDOP_1_994_02_05_01_01.xsd',
  updTitle0: 'resources/schemas/upd/utd970_05_03_01/ON_NSCHFDOPPR_1_997_01_05_03_05.xsd',
  updTitle1: 'resources/schemas/upd/utd970_05_03_01/ON_NSCHFDOPPOK_1_997_02_05_03_01.xsd',
};

describe('pinned XSD matrix', () => {
  const validator = new XsdValidatorService(config);

  it('accepts the sample only by the TORG-2 buyer-title schema', async () => {
    await validator.onModuleInit();

    const own = await validator.validate(schemas.torg2Title0, sample);
    expect(own.valid).toBe(true);
    expect(own.details).toHaveLength(0);

    for (const [name, path] of Object.entries(schemas)) {
      if (name === 'torg2Title0') continue;
      const result = await validator.validate(path, sample);
      expect(result.valid, `${name} must reject the sample`).toBe(false);
      expect(result.details.length).toBeGreaterThan(0);
      const serialized = JSON.stringify(result.details);
      expect(serialized).not.toContain('/tmp/');
      expect(serialized).not.toContain('xml-');
    }
  }, 60_000);

  it('accepts the TORG-2 seller title only by its own schema', async () => {
    await validator.onModuleInit();
    const own = await validator.validate(schemas.torg2Title1, torg2Title1Sample);
    expect(own.valid).toBe(true);
    for (const [name, path] of Object.entries(schemas)) {
      if (name === 'torg2Title1') continue;
      const result = await validator.validate(path, torg2Title1Sample);
      expect(result.valid, `${name} must reject the TORG-2 title 1 sample`).toBe(false);
    }
  }, 60_000);

  it('accepts the UPD buyer title only by its own schema', async () => {
    await validator.onModuleInit();
    const own = await validator.validate(schemas.updTitle1, updTitle1Sample);
    expect(own.valid).toBe(true);
    for (const [name, path] of Object.entries(schemas)) {
      if (name === 'updTitle1') continue;
      const result = await validator.validate(path, updTitle1Sample);
      expect(result.valid, `${name} must reject the UPD title 1 sample`).toBe(false);
    }
  }, 60_000);

  it('accepts the UPD sample only by the UPD seller-title schema', async () => {
    await validator.onModuleInit();
    const own = await validator.validate(schemas.updTitle0, updSample);
    expect(own.valid).toBe(true);

    for (const [name, path] of Object.entries(schemas)) {
      if (name === 'updTitle0') continue;
      const result = await validator.validate(path, updSample);
      expect(result.valid, `${name} must reject the UPD sample`).toBe(false);
    }
  }, 60_000);
});
