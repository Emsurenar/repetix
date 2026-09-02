// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { initSelect } from '../src/ui/select.js';

/* Den nativa väljaren låg kvar som ett fokuserbart element bakom appens egen
 * knapp, och två saker gav den fokus utan att någon bett om det: fokusfällan
 * och etiketten. På en telefon är fokus i en select detsamma som att
 * systemets egen rullista öppnas — bredvid appens, samtidigt. */
describe('initSelect', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <label for="valj">Välj plats</label>
      <select id="valj"><option value="a">A</option><option value="b" selected>B</option></select>
    `;
  });

  it('tar den nativa väljaren ur tabbordningen och ur hjälpmedlens träd', () => {
    const select = document.getElementById('valj');
    initSelect(select);
    expect(select.tabIndex).toBe(-1);
    expect(select.getAttribute('aria-hidden')).toBe('true');
  });

  it('pekar om etiketten till knappen', () => {
    const select = document.getElementById('valj');
    initSelect(select);
    const trigger = document.querySelector('.select-trigger');
    expect(trigger.id).toBe('valj-valjare');
    expect(document.querySelector('label').htmlFor).toBe('valj-valjare');
  });

  it('visar det valda och följer en ändring av värdet', () => {
    const select = document.getElementById('valj');
    initSelect(select);
    const etikett = document.querySelector('.select-value');
    expect(etikett.textContent).toBe('B');
    select.value = 'a';
    expect(etikett.textContent).toBe('A');
  });

  it('klär inte samma väljare två gånger', () => {
    const select = document.getElementById('valj');
    initSelect(select);
    initSelect(select);
    expect(document.querySelectorAll('.select-trigger')).toHaveLength(1);
  });
});
