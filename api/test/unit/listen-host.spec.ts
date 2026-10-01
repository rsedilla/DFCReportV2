import { loadConfig } from '../../src/config/configuration';

/**
 * The address the API listens on. Its default is the one that matters: a deployment that
 * never sets `HOST` must not answer on every address of the machine.
 */
describe('the listen address', () => {
  const original = process.env.HOST;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.HOST;
    } else {
      process.env.HOST = original;
    }
  });

  it('is 127.0.0.1 when HOST is unset', () => {
    delete process.env.HOST;

    expect(loadConfig().host).toBe('127.0.0.1');
  });

  it('is 127.0.0.1 when HOST is present and blank, which is what a template renders', () => {
    process.env.HOST = '  ';

    expect(loadConfig().host).toBe('127.0.0.1');
  });

  it('is the address HOST names', () => {
    process.env.HOST = '0.0.0.0';

    expect(loadConfig().host).toBe('0.0.0.0');
  });

  it('refuses a value that is not an IP address rather than guessing', () => {
    process.env.HOST = 'localhost';

    expect(() => loadConfig()).toThrow(/HOST must be an IP address/);
  });
});
