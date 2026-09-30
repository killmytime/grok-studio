import { readUncensored, writeUncensored, UNCENSORED_KEY } from '../app/lib/uncensor';

describe('uncensor session', () => {
  afterEach(() => sessionStorage.clear());

  it('stays censored until this browser session turns it on', () => {
    expect(readUncensored()).toBe(false);
    writeUncensored(true);
    expect(sessionStorage.getItem(UNCENSORED_KEY)).toBe('1');
    expect(readUncensored()).toBe(true);
    writeUncensored(false);
    expect(readUncensored()).toBe(false);
  });
});
