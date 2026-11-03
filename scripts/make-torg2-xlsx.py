#!/usr/bin/env python3
"""Build a comparison workbook from the TORG-2 XML.

This is a data workbook, not the official printable form. It mirrors the
values used by the PDF so the XML, XLSX and PDF can be compared cell by cell.
"""
import hashlib
import re
import sys
from decimal import Decimal
from pathlib import Path
import xml.etree.ElementTree as ET

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

XML = Path(sys.argv[1] if len(sys.argv) > 1 else '/Users/admin/Downloads/DP_PRIRASXPRINMARK_2BEb4c480c0b9194862b873e91634ba96d7_2BE7c11a.xml')
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else 'torg2-current.xlsx')


def load(path: Path):
    raw = path.read_bytes()
    text = raw.decode('cp1251') if raw.startswith(b'<?xml') else raw.decode('utf-8')
    text = re.sub(r'encoding="[^"]*"', 'encoding="utf-8"', text, count=1)
    return raw, ET.fromstring(text)


def a(node, name):
    return node.get(name) if node is not None else None


def text(node, path):
    found = node.find(path) if node is not None else None
    return (found.text or '').strip() if found is not None and found.text else None


def money(raw):
    if raw in (None, ''):
        return ''
    try:
        value = Decimal(raw.replace(',', '.'))
        sign = '-' if value < 0 else ''
        fixed = f'{abs(value):.2f}'
        whole, frac = fixed.split('.')
        whole = f'{int(whole):,}'.replace(',', ' ')
        return f'{sign}{whole},{frac}'
    except Exception:
        return raw


def qty(raw):
    if raw in (None, ''):
        return ''
    try:
        value = Decimal(raw.replace(',', '.'))
        fixed = format(value, 'f')
        if '.' in fixed:
            fixed = fixed.rstrip('0').rstrip('.')
        return fixed.replace('.', ',')
    except Exception:
        return raw


def fio(node):
    if node is None:
        return ''
    return ' '.join(filter(None, [a(node, 'Фамилия'), a(node, 'Имя'), a(node, 'Отчество')]))


def party(node):
    if node is None:
        return {}
    identity = node.find('ИдСв')
    org = identity.find('СвОрг/СвОргУч') if identity is not None else None
    ip = identity.find('СвИП') if identity is not None else None
    fl = identity.find('СвФЛ') if identity is not None else None
    if org is not None:
        name = a(org, 'НаимОрг') or ''
        inn, kpp = a(org, 'ИННЮЛ'), a(org, 'КПП')
    elif ip is not None:
        name = fio(ip.find('ФИО'))
        inn, kpp = a(ip, 'ИННФЛ'), None
    elif fl is not None:
        name = fio(fl.find('ФИО'))
        inn, kpp = a(fl, 'ИННФЛ'), None
    else:
        name = inn = kpp = None
    addr = node.find('Адрес')
    address = ''
    if addr is not None:
        inf = addr.find('АдрИнф')
        rf = addr.find('АдрРФ')
        if inf is not None:
            address = a(inf, 'АдрТекст') or ''
        elif rf is not None:
            parts = [a(rf, 'Индекс'), a(rf, 'Город'), a(rf, 'НаселПункт'), a(rf, 'Улица'), a(rf, 'Дом'), a(rf, 'Корпус'), a(rf, 'Кварт')]
            address = ', '.join(filter(None, parts))
    bank_node = node.find('БанкРекв')
    bank = ''
    if bank_node is not None:
        b = bank_node.find('СвБанк')
        bank = ', '.join(filter(None, [a(bank_node, 'НомерСчета'), a(b, 'НаимБанк'), a(b, 'БИК'), a(b, 'КорСчет')]))
    return {'name': name or '', 'inn': inn or '', 'kpp': kpp or '', 'address': address, 'bank': bank,
            'okpo': a(node, 'ОКПО') or '', 'phone': a(node.find('Контакт'), 'Тлф') or '',
            'email': a(node.find('Контакт'), 'ЭлПочта') or '', 'reg': a(ip, 'СвГосРегИП') if ip is not None else ''}


def style_header(ws, row, count, fill='D9E2F3'):
    for c in range(1, count + 1):
        cell = ws.cell(row, c)
        cell.font = Font(bold=True, size=10)
        cell.fill = PatternFill('solid', fgColor=fill)
        cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
        cell.border = Border(*([Side(style='thin')] * 4))


def autosize(ws, widths):
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w


def main():
    raw, root = load(XML)
    doc = root.find('Документ')
    body = doc.find('СодФХЖ1')
    content = doc.find('СодФХЖ2')
    parties = {label: party(body.find(tag)) for label, tag in [
        ('Продавец', 'Продавец'), ('Покупатель', 'Покупатель'), ('Грузоотправитель', 'Грузоотправитель'),
        ('Грузополучатель', 'Грузополучатель'), ('Страховая компания', 'СтрахКом')]}

    wb = Workbook()
    ws = wb.active
    ws.title = 'Акт'
    ws.sheet_view.showGridLines = False
    ws.page_setup.orientation = 'landscape'
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0

    rows = [
        ('Документ', a(doc, 'ПоФактХЖ')), ('Составитель', a(doc, 'НаимЭконСубСост')),
        ('Номер документа', a(doc.find('ИдентДокПР'), 'НомДокПР')),
        ('Дата составления', a(doc.find('ИдентДокПР'), 'ДатаДокПР')),
        ('КНД', a(doc, 'КНД')), ('Исправление №', a(doc.find('ИспрДокПР'), 'НомИспрДокПР')),
        ('Исправление от', a(doc.find('ИспрДокПР'), 'ДатаИспрДокПР')),
        ('Место приемки', a(body.find('СвОсмГруз'), 'МестоСост')),
        ('Сопроводительный документ', '; '.join(filter(None, [
            ' '.join(filter(None, [a(x, 'НаимСопрДок'), a(x, 'НомСопрДок'), a(x, 'ДатаСопрДок')]))
            for x in body.findall('СвОсмГруз/СопрДок')]))),
        ('Дата отправления', a(body.find('СвОсмГруз'), 'ДатаОтпр')),
        ('Дата вскрытия тары', a(body.find('СвВремПрием'), 'ВскрытГруз')),
        ('СодСоб', a(content, 'СодСоб')), ('Заключение', a(content, 'Заключение')),
        ('ИнфДопСв', ', '.join((x.text or '').strip() for x in doc.findall('ИнфДопСв'))),
    ]
    ws.append(['Поле', 'Значение']); style_header(ws, 1, 2)
    for r in rows:
        ws.append(list(r))
    for r in range(2, ws.max_row + 1):
        ws.cell(r, 1).font = Font(bold=True)
        ws.cell(r, 2).alignment = Alignment(wrap_text=True, vertical='top')
    autosize(ws, [32, 120])

    for label, p in parties.items():
        ws.append([])
        ws.append([label, '']); style_header(ws, ws.max_row, 2, 'E2EFDA')
        for key, value in [('Наименование', 'name'), ('ИНН', 'inn'), ('КПП', 'kpp'), ('ОКПО', 'okpo'),
                           ('Адрес', 'address'), ('Банк', 'bank'), ('Телефон', 'phone'), ('E-mail', 'email'),
                           ('Регистрация', 'reg')]:
            if p.get(value):
                ws.append([key, p[value]])
                ws.cell(ws.max_row, 1).font = Font(italic=True)
                ws.cell(ws.max_row, 2).alignment = Alignment(wrap_text=True, vertical='top')

    goods = wb.create_sheet('Товары')
    headers = ['№', 'Товар', 'Ед. изм.', 'ОКЕИ', 'Артикул', 'Сорт', 'Код', 'Характеристика',
               'Строка', 'Кол-во док.', 'Цена док.', 'Сумма док.', 'НДС док.', 'Сумма НДС док.',
               'Кол-во факт.', 'Цена факт.', 'Сумма факт.', 'НДС факт.', 'Сумма НДС факт.', 'Паспорт']
    goods.append(headers); style_header(goods, 1, len(headers))
    for index, rez in enumerate(content.findall('РезПрием'), 1):
        c = rez.find('Ценности')
        pd, pf = rez.find('ПоДокум'), rez.find('ПоФакту')
        goods.append([index, a(c, 'НаимТов'), a(rez, 'НаимЕдИзм'), a(rez, 'ОКЕИ_Тов'),
                      a(c, 'АртикулТов'), a(c, 'СортТов'), a(c, 'КодТов'), a(c, 'ХарактТов'),
                      a(c, 'НомСтрСопрДок'),
                      qty(a(pd, 'КолТовПрин')), money(a(pd, 'ЦенаПрин')), money(a(pd, 'СтоимТовНДСПрин')),
                      a(pd, 'СтавНДСПрин'), money(a(pd, 'СумНДСПрин')),
                      qty(a(pf, 'КолТовПрин')), money(a(pf, 'ЦенаПрин')), money(a(pf, 'СтоимТовНДСПрин')),
                      a(pf, 'СтавНДСПрин'), money(a(pf, 'СумНДСПрин')), a(c, 'Паспорт')])
    autosize(goods, [5, 44, 12, 8, 10, 8, 10, 20, 10, 12, 12, 14, 9, 12, 12, 12, 14, 9, 12, 12])
    for row in goods.iter_rows(min_row=2, max_row=goods.max_row, max_col=len(headers)):
        for cell in row:
            cell.alignment = Alignment(wrap_text=True, vertical='top')
            cell.border = Border(*([Side(style='thin')] * 4))
    goods.freeze_panes = 'C2'

    disc = wb.create_sheet('Расхождения')
    dh = ['№', 'Товар', 'Брак кол-во', 'Брак сумма', 'Брак НДС', 'Брак пояснение',
          'Бой кол-во', 'Бой сумма', 'Бой НДС', 'Бой пояснение',
          'Недостача кол-во', 'Недостача сумма', 'Недостача НДС', 'Недостача пояснение',
          'Излишки кол-во', 'Излишки сумма', 'Излишки НДС', 'Излишки пояснение']
    disc.append(dh); style_header(disc, 1, len(dh))
    for index, rez in enumerate(content.findall('РезПрием'), 1):
        c = rez.find('Ценности')
        row = [index, a(c, 'НаимТов')]
        for tag in ['Брак', 'Бой', 'Недостача', 'Излишки']:
            n = rez.find(tag)
            row += [qty(a(n, 'КолТовРасх')), money(a(n, 'СтоимТовНДСРасх')), money(a(n, 'СумНДСРасх')),
                    a(n, 'ПоясненияРасх')]
        disc.append(row)
    autosize(disc, [5, 44] + [12, 14, 12, 22] * 4)
    for row in disc.iter_rows(min_row=2, max_row=disc.max_row, max_col=len(dh)):
        for cell in row:
            cell.alignment = Alignment(wrap_text=True, vertical='top')
            cell.border = Border(*([Side(style='thin')] * 4))
    disc.freeze_panes = 'C2'

    sign = wb.create_sheet('Подписант')
    sign.append(['Поле', 'Значение']); style_header(sign, 1, 2)
    for person in doc.findall('Подписант'):
        org = person.find('ИП') or person.find('ЮЛ') or person.find('ФЛ')
        sign.append(['ФИО', fio(org.find('ФИО') if org is not None else None)])
        sign.append(['ИНН', a(org, 'ИННФЛ') or a(org, 'ИННЮЛ') or ''])
        sign.append(['Должность', a(org, 'Должн') or ''])
        sign.append(['Область полномочий', a(person, 'ОблПолн') or ''])
        sign.append(['Статус', a(person, 'Статус') or ''])
        sign.append(['Основание полномочий', a(person, 'ОснПолн') or ''])
        sign.append(['Основание организации', a(person, 'ОснПолнОрг') or ''])
    autosize(sign, [30, 70])

    meta = wb.create_sheet('Источник')
    meta.append(['Параметр', 'Значение']); style_header(meta, 1, 2)
    meta.append(['Файл', XML.name])
    meta.append(['SHA-256', hashlib.sha256(raw).hexdigest()])
    meta.append(['Размер, байт', len(raw)])
    meta.append(['Назначение', 'Данные для сверки XML ↔ PDF. Не является официальным печатным бланком.'])

    for sheet in wb.worksheets:
        sheet.page_setup.orientation = 'landscape'
        sheet.page_setup.paperSize = sheet.PAPERSIZE_A4
        sheet.page_setup.fitToWidth = 1
        sheet.page_setup.fitToHeight = 0
    wb.save(OUT)
    print(OUT)


if __name__ == '__main__':
    main()
