import type { XmlNode } from '../../xml-security/xml-tree';
import { joinNonEmpty } from './format';
import { regionName } from './regions';
import type { XmlAccessor } from './xml-access';

const MUNICIPALITY_TYPES: Record<string, string> = {
  '1': 'муниципальный район',
  '2': 'городской округ',
  '3': 'внутригородская территория',
  '4': 'городское поселение',
  '5': 'сельское поселение',
};

export function readAddress(accessor: XmlAccessor, address: XmlNode | undefined): string | undefined {
  if (!address) return undefined;

  const rf = address.child('АдрРФ');
  if (rf) {
    const index = accessor.attr(rf, 'Индекс');
    // UPD requires НаимРегион and carries it explicitly; TORG-2 only has the code.
    const regionCode = accessor.attr(rf, 'КодРегион', 'technical', 'Код региона; печатается наименование региона');
    const region = accessor.attr(rf, 'НаимРегион') ?? regionName(regionCode);
    const district = accessor.attr(rf, 'Район');
    const city = accessor.attr(rf, 'Город');
    const locality = accessor.attr(rf, 'НаселПункт');
    const street = accessor.attr(rf, 'Улица');
    const house = accessor.attr(rf, 'Дом');
    const building = accessor.attr(rf, 'Корпус');
    const flat = accessor.attr(rf, 'Кварт');
    const text = joinNonEmpty([
      index,
      region,
      district,
      city,
      locality,
      street,
      house,
      building ? `корп. ${building}` : undefined,
      flat ? `кв. ${flat}` : undefined,
    ]);
    return text || undefined;
  }

  const info = address.child('АдрИнф');
  if (info) {
    const countryCode = accessor.attr(info, 'КодСтр', 'technical', 'Код страны адреса; печатается наименование страны');
    const country = accessor.attr(info, 'НаимСтран');
    const text = accessor.attr(info, 'АдрТекст');
    if (!text) return undefined;
    const prefix = country
      ? country.toUpperCase() === 'РОССИЯ'
        ? undefined
        : country
      : countryCode && countryCode !== '643'
        ? `Страна ${countryCode}`
        : undefined;
    return prefix ? `${prefix}, ${text}` : text;
  }

  const garAddress = address.child('АдрГАР');
  if (garAddress) {
    const index = accessor.attr(garAddress, 'Индекс');
    const region = accessor.text(garAddress.child('НаимРегион'));
    const districtNode = garAddress.child('МуниципРайон');
    const district = districtNode
      ? joinNonEmpty([
          MUNICIPALITY_TYPES[accessor.attr(districtNode, 'ВидКод') ?? ''] ?? '',
          accessor.attr(districtNode, 'Наим'),
        ], ' ')
      : undefined;
    const localityNode = garAddress.child('НаселенПункт');
    const locality = localityNode
      ? joinNonEmpty([accessor.attr(localityNode, 'Вид'), accessor.attr(localityNode, 'Наим')], ' ')
      : undefined;
    const planningNode = garAddress.child('ЭлПланСтруктур');
    const planning = planningNode
      ? joinNonEmpty([accessor.attr(planningNode, 'Тип'), accessor.attr(planningNode, 'Наим')], ' ')
      : undefined;
    const streetNode = garAddress.child('ЭлУлДорСети');
    const street = streetNode
      ? joinNonEmpty([accessor.attr(streetNode, 'Тип'), accessor.attr(streetNode, 'Наим')], ' ')
      : undefined;
    const buildingNode = garAddress.child('Здание');
    const building = buildingNode
      ? joinNonEmpty([accessor.attr(buildingNode, 'Тип'), accessor.attr(buildingNode, 'Номер')], ' ')
      : undefined;
    const flatNode = garAddress.child('ПомещКвартиры');
    const flat = flatNode
      ? joinNonEmpty([accessor.attr(flatNode, 'Тип'), accessor.attr(flatNode, 'Номер')], ' ')
      : undefined;
    const text = joinNonEmpty([index, region, district, locality, planning, street, building, flat]);
    return text || undefined;
  }

  const gar = address.child('КодГАР');
  if (gar) {
    accessor.technical(gar, 'Код ГАР адреса; хранится в XML, в бланк не выводится');
  }
  return undefined;
}
