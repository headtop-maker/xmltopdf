import type { PartyModel } from './party';

/** Presentation-only helper: party identity, address and contacts as printed lines. */
export function formatPartyForPrint(party: PartyModel): { title: string; lines: string[] } {
  const registration = [
    party.inn ? `ИНН: ${party.inn}` : undefined,
    party.kpp ? `КПП: ${party.kpp}` : undefined,
    party.okpo ? `ОКПО: ${party.okpo}` : undefined,
    party.ogrn ? `${party.kind === 'ИП' ? 'ОГРНИП' : 'ОГРН'} ${party.ogrn}` : undefined,
  ]
    .filter(Boolean)
    .join(', ');
  return {
    title: [party.name, party.kind === 'ИП' ? 'ИП' : party.kind === 'ЮЛ' ? '' : party.kind].filter(Boolean).join(' '),
    lines: [
      registration,
      party.foreignId ? `Идентификатор: ${party.foreignId}` : '',
      party.address ?? '',
      party.registration ? `Регистрация: ${party.registration}` : '',
      party.registrationDate ? `Дата регистрации: ${party.registrationDate}` : '',
      [party.phone ? `тел. ${party.phone}` : undefined, party.email].filter(Boolean).join(', '),
      party.otherInfo ?? '',
      party.bank ?? '',
    ].filter((line) => line.trim() !== ''),
  };
}
