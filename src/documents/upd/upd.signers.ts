import type { XmlNode } from '../../xml-security/xml-tree';
import type { XmlAccessor } from '../shared/xml-access';
import { formatFio } from '../shared/party';
import type { UpdSigner } from './upd.model';

/** Signer block shared by the UPD seller and buyer titles. */
export function readUpdSigner(accessor: XmlAccessor, node: XmlNode): UpdSigner {
    const powersOfAttorney: string[] = [];
    for (const poa of node.childrenNamed('СвДоверЭл')) {
      powersOfAttorney.push(
        [
          accessor.attr(poa, 'НомДовер'),
          accessor.attr(poa, 'ДатаВыдДовер'),
          accessor.attr(poa, 'ИдСистХран'),
        ]
          .filter(Boolean)
          .join(' от '),
      );
    }
    for (const poa of node.childrenNamed('СвДоверБум')) {
      powersOfAttorney.push(
        [accessor.attr(poa, 'ВнНомДовер'), accessor.attr(poa, 'ДатаВыдДовер')].filter(Boolean).join(' от '),
      );
    }
    return {
      fio: formatFio(node.child('ФИО'), accessor),
      position: accessor.attr(node, 'Должн'),
      signatureType: accessor.attr(node, 'ТипПодпис'),
      authorityMethod: accessor.attr(node, 'СпосПодтПолном'),
      signedDate: accessor.attr(node, 'ДатаПодДок'),
      additional: accessor.attr(node, 'ДопСведПодп'),
      powersOfAttorney,
    };
  }
