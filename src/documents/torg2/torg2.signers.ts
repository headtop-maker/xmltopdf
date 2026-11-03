import type { XmlNode } from '../../xml-security/xml-tree';
import { formatFio } from '../shared/party';
import type { XmlAccessor } from '../shared/xml-access';
import type { Torg2Signer } from './torg2.model';

/** TORG-2 signer block is identical in both buyer and seller titles. */
export function readTorg2Signer(accessor: XmlAccessor, node: XmlNode): Torg2Signer {
    const scopeCode = accessor.attr(node, 'ОблПолн');
    const statusCode = accessor.attr(node, 'Статус');
    const basis = accessor.attr(node, 'ОснПолн') ?? '';
    const organizationBasis = accessor.attr(node, 'ОснПолнОрг');
    const acknowledgment = accessor.attr(node, 'ПризнОзнак');

    const legalEntity = node.child('ЮЛ');
    const entrepreneur = node.child('ИП');
    const individual = node.child('ФЛ');

    if (legalEntity) {
      return {
        kind: 'ЮЛ',
        fio: formatFio(legalEntity.child('ФИО'), accessor),
        position: accessor.attr(legalEntity, 'Должн'),
        organization: accessor.attr(legalEntity, 'НаимОрг'),
        inn: accessor.attr(legalEntity, 'ИННЮЛ'),
        other: accessor.attr(legalEntity, 'ИныеСвед'),
        basis,
        organizationBasis,
        acknowledgment,
        statusCode,
        scopeCode,
      };
    }
    if (entrepreneur) {
      return {
        kind: 'ИП',
        fio: formatFio(entrepreneur.child('ФИО'), accessor),
        inn: accessor.attr(entrepreneur, 'ИННФЛ'),
        other: accessor.attr(entrepreneur, 'ИныеСвед'),
        basis,
        organizationBasis,
        acknowledgment,
        statusCode,
        scopeCode,
      };
    }
    if (individual) {
      return {
        kind: 'ФЛ',
        fio: formatFio(individual.child('ФИО'), accessor),
        inn: accessor.attr(individual, 'ИННФЛ'),
        other: accessor.attr(individual, 'ИныеСвед'),
        basis,
        organizationBasis,
        acknowledgment,
        statusCode,
        scopeCode,
      };
    }
    return {
      kind: 'не указано',
      basis,
      organizationBasis,
      acknowledgment,
      statusCode,
      scopeCode,
    };
  }

