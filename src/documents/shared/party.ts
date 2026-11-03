import type { XmlNode } from '../../xml-security/xml-tree';
import { readAddress } from './address';
import { joinNonEmpty } from './format';
import type { XmlAccessor } from './xml-access';

export type PartyKind = 'ЮЛ' | 'ИП' | 'ФЛ' | 'Иностранная организация';

export interface PartyModel {
  readonly kind: PartyKind;
  readonly name: string;
  readonly inn?: string;
  readonly kpp?: string;
  readonly okpo?: string;
  readonly ogrn?: string;
  readonly foreignId?: string;
  readonly otherInfo?: string;
  readonly address?: string;
  readonly phone?: string;
  readonly email?: string;
  readonly bank?: string;
  readonly registration?: string;
  readonly registrationDate?: string;
}

export function formatFio(node: XmlNode | undefined, accessor: XmlAccessor): string | undefined {
  if (!node) return undefined;
  const last = accessor.attr(node, 'Фамилия');
  const first = accessor.attr(node, 'Имя');
  const middle = accessor.attr(node, 'Отчество');
  return joinNonEmpty([last, first, middle], ' ') || undefined;
}

/**
 * Reads a participant from either format family:
 * TORG-2 uses ИдСв/СвОрг/СвОргУч, UPD uses ИдСв/СвЮЛУч directly and СвФЛУч
 * instead of СвФЛ. Contacts are attributes in TORG-2 and elements in UPD.
 */
export function readParty(accessor: XmlAccessor, participant: XmlNode): PartyModel | undefined {
  const identity = participant.child('ИдСв');
  if (!identity) return undefined;

  const organization = identity.child('СвОрг');
  const legalEntity = identity.child('СвЮЛУч') ?? organization?.child('СвОргУч');
  const foreignEntity = identity.child('СвИнНеУч') ?? organization?.child('СвИнНеУч');
  const entrepreneur = identity.child('СвИП');
  const individual = identity.child('СвФЛ') ?? identity.child('СвФЛУч');

  let party: PartyModel | undefined;
  if (legalEntity) {
    party = {
      kind: 'ЮЛ',
      name: accessor.attr(legalEntity, 'НаимОрг') ?? '',
      inn: accessor.attr(legalEntity, 'ИННЮЛ'),
      kpp: accessor.attr(legalEntity, 'КПП'),
    };
  } else if (foreignEntity) {
    party = {
      kind: 'Иностранная организация',
      name: accessor.attr(foreignEntity, 'НаимОрг') ?? '',
      foreignId: accessor.attr(foreignEntity, 'Идентиф'),
      otherInfo: accessor.attr(foreignEntity, 'ИныеСвед'),
    };
  } else if (entrepreneur) {
    party = {
      kind: 'ИП',
      name: formatFio(entrepreneur.child('ФИО'), accessor) ?? '',
      inn: accessor.attr(entrepreneur, 'ИННФЛ'),
      ogrn: accessor.attr(entrepreneur, 'ОГРНИП'),
      registration: accessor.attr(entrepreneur, 'СвГосРегИП'),
      registrationDate: accessor.attr(entrepreneur, 'ДатаОГРНИП'),
      otherInfo: accessor.attr(entrepreneur, 'ИныеСвед'),
    };
  } else if (individual) {
    party = {
      kind: 'ФЛ',
      name: formatFio(individual.child('ФИО'), accessor) ?? '',
      inn: accessor.attr(individual, 'ИННФЛ'),
      otherInfo: accessor.attr(individual, 'ИныеСвед') ?? accessor.attr(individual, 'ИдСтатЛ'),
    };
  }

  if (!party) return undefined;

  const okpo = accessor.attr(participant, 'ОКПО');
  const address = readAddress(accessor, participant.child('Адрес'));
  const contact = participant.child('Контакт');
  const phone = contact
    ? accessor.attr(contact, 'Тлф') ?? accessor.text(contact.child('Тлф'))
    : undefined;
  const email = contact
    ? accessor.attr(contact, 'ЭлПочта') ?? accessor.text(contact.child('ЭлПочта'))
    : undefined;

  const bankNode = participant.child('БанкРекв');
  let bank: string | undefined;
  if (bankNode) {
    const account = accessor.attr(bankNode, 'НомерСчета');
    const bankInfo = bankNode.child('СвБанк');
    const bankName = bankInfo ? accessor.attr(bankInfo, 'НаимБанк') : undefined;
    const bik = bankInfo ? accessor.attr(bankInfo, 'БИК') : undefined;
    const corr = bankInfo ? accessor.attr(bankInfo, 'КорСчет') : undefined;
    bank =
      joinNonEmpty([
        account ? `р/с ${account}` : undefined,
        bankName,
        bik ? `БИК ${bik}` : undefined,
        corr ? `к/с ${corr}` : undefined,
      ]) || undefined;
  }

  return { ...party, okpo, address, phone, email, bank };
}

export function partyKindLabel(kind: PartyKind): string {
  switch (kind) {
    case 'ЮЛ':
      return 'юридическое лицо';
    case 'ИП':
      return 'индивидуальный предприниматель';
    case 'ФЛ':
      return 'физическое лицо';
    case 'Иностранная организация':
      return 'иностранная организация';
  }
}
