import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../src/config';
import { VislibRendererService } from '../../src/rendering/vislib-renderer.service';

function config(overrides: Partial<AppConfig['vislib']> = {}): AppConfig {
  return {
    vislib: {
      enabled: false,
      javaPath: 'java',
      timeoutMs: 1000,
      ...overrides,
    },
  } as AppConfig;
}

describe('optional vislib renderer', () => {
  it('is disabled by default and fails closed', async () => {
    const service = new VislibRendererService(config());
    expect(service.enabled).toBe(false);
    expect(service.version).toBe('disabled');
    await expect(service.render(Buffer.from('<x/>'))).rejects.toThrow('not configured');
  });

  it('requires both the JAR and the template directory', () => {
    expect(new VislibRendererService(config({ enabled: true, jar: '/tmp/a.jar' })).enabled).toBe(false);
    expect(
      new VislibRendererService(config({ enabled: true, templatesDir: '/tmp/templates' })).enabled,
    ).toBe(false);
    expect(
      new VislibRendererService(
        config({ enabled: true, jar: '/tmp/a.jar', templatesDir: '/tmp/templates' }),
      ).enabled,
    ).toBe(true);
  });
});
