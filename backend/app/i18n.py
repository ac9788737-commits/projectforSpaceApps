"""English for the sentences the server writes (docs/IMPROVEMENTS.md B12).

The generators write Russian; with `lang=en` the API passes every text through these
templates. The set of sentences is finite and known, and a test checks that no Cyrillic is
left in the English answers for the demo fields. Tajik («tg») gets crop names; other server
sentences stay Russian, which is common in Tajikistan.
"""

from __future__ import annotations

import re
from typing import Any

CROPS = {
    # id: (ru nominative, en, tg)
    "wheat": ("Пшеница яровая", "Spring wheat", "Гандуми баҳорӣ"),
    "winter_wheat": ("Пшеница озимая", "Winter wheat", "Гандуми тирамоҳӣ"),
    "barley": ("Ячмень", "Barley", "Ҷав"),
    "maize": ("Кукуруза", "Maize", "Ҷуворимакка"),
    "pea": ("Горох", "Pea", "Нахӯд"),
    "chickpea": ("Нут", "Chickpea", "Нахӯди кабӯдӣ"),
    "alfalfa": ("Люцерна", "Alfalfa", "Юнучқа"),
    "soybean": ("Соя", "Soybean", "Соя"),
    "potato": ("Картофель", "Potato", "Картошка"),
    "tomato": ("Томат", "Tomato", "Помидор"),
    "cotton": ("Хлопчатник", "Cotton", "Пахта"),
    "sunflower": ("Подсолнечник", "Sunflower", "Офтобпараст"),
    "vetch": ("Вика", "Vetch", "Вика"),
    "clover": ("Клевер", "Clover", "Себарга"),
    "rye_cover": ("Озимая рожь на сидерат", "Cereal rye (green manure)", "Ҷавдор (сидерат)"),
    "mustard": ("Горчица", "Mustard", "Хардал"),
    "phacelia": ("Фацелия", "Phacelia", "Фатселия"),
}
# Russian word forms → English (longest first so «пшеница озимая» wins over «пшеница»)
FORMS = {
    "пшеница яровая": "spring wheat",
    "яровой пшеницы": "spring wheat",
    "пшеница озимая": "winter wheat",
    "озимой пшеницы": "winter wheat",
    "ячмень": "barley",
    "ячменя": "barley",
    "кукуруза": "maize",
    "кукурузы": "maize",
    "горох": "pea",
    "гороха": "pea",
    "нут": "chickpea",
    "нута": "chickpea",
    "люцерна": "alfalfa",
    "люцерны": "alfalfa",
    "соя": "soybean",
    "сои": "soybean",
    "картофель": "potato",
    "картофеля": "potato",
    "томат": "tomato",
    "томата": "tomato",
    "хлопчатник": "cotton",
    "хлопчатника": "cotton",
    "подсолнечник": "sunflower",
    "подсолнечника": "sunflower",
    "вика": "vetch",
    "вику": "vetch",
    "клевер": "clover",
    "озимая рожь на сидерат": "cereal rye",
    "рожь": "cereal rye",
    "вика (покровная)": "vetch (cover)",
    "клевер (покровный)": "clover (cover)",
    "горчица (покровная)": "mustard (cover)",
    "фацелия (покровная)": "phacelia (cover)",
    "покровная": "cover crop",
    "горчица": "mustard",
    "горчицу": "mustard",
    "фацелия": "phacelia",
    "фацелию": "phacelia",
    "злаковые": "cereals",
    "бобовые": "legumes",
    "паслёновые": "nightshades",
    "мальвовые": "mallows",
    "астровые": "asters",
    "капустные": "brassicas",
    "бурачниковые": "borages",
}
MONTHS = dict(
    zip(
        (
            "январь",
            "февраль",
            "март",
            "апрель",
            "май",
            "июнь",
            "июль",
            "август",
            "сентябрь",
            "октябрь",
            "ноябрь",
            "декабрь",
        ),
        (
            "January",
            "February",
            "March",
            "April",
            "May",
            "June",
            "July",
            "August",
            "September",
            "October",
            "November",
            "December",
        ),
        strict=True,
    )
)
MONTHS_GEN = dict(
    zip(
        (
            "января",
            "февраля",
            "марта",
            "апреля",
            "мая",
            "июня",
            "июля",
            "августа",
            "сентября",
            "октября",
            "ноября",
            "декабря",
        ),
        (
            "January",
            "February",
            "March",
            "April",
            "May",
            "June",
            "July",
            "August",
            "September",
            "October",
            "November",
            "December",
        ),
        strict=True,
    )
)
MONTHS_LOC = dict(
    zip(
        (
            "январе",
            "феврале",
            "марте",
            "апреле",
            "мае",
            "июне",
            "июле",
            "августе",
            "сентябре",
            "октябре",
            "ноябре",
            "декабре",
        ),
        MONTHS_GEN.values(),
        strict=True,
    )
)
STAGES = {
    "всходах": "emergence",
    "росте": "growth",
    "цветении": "flowering",
    "созревании": "ripening",
}
SEASONS = {"зимой": "winter", "весной": "spring", "летом": "summer", "осенью": "autumn"}


def _w(word: str) -> str:
    w = re.sub(r" \(покровн\w+\)$", "", word.strip())
    low = w.lower()
    for k in sorted(FORMS, key=len, reverse=True):
        if low == k:
            out = FORMS[k]
            return out[0].upper() + out[1:] if w[:1].isupper() else out
    return w


def _num(s: str) -> str:
    return s.replace(",", ".").replace("−", "-")


C = r"([А-ЯЁа-яё][А-ЯЁа-яё ()]*?)"
N = r"([−+-]?[\d ,.]+)"
PATTERNS: list[tuple[str, Any]] = [
    # links
    (
        rf"^{C} в (\d+)-й год → в (\d+)-й год на (\d+) кг/га меньше азотных удобрений \(экономия ≈ \$(\d+)/га\)(?:, урожай {C} {N} %)?$",
        lambda m: (
            f"{_w(m[1])} in year {m[2]} → year {m[3]} needs {m[4]} kg/ha less nitrogen fertiliser (saves ≈ ${m[5]}/ha)"
            + (f", {_w(m[6])} yield {_num(m[7])} %" if m[6] else "")
        ),
    ),
    (
        rf"^{C} → азот и остатки → {C} {N} %$",
        lambda m: f"{_w(m[1])} → nitrogen and residues → {_w(m[2])} {_num(m[3])} %",
    ),
    (
        rf"^{C} в межсезонье → смыв почвы {N} %$",
        lambda m: f"{_w(m[1])} between seasons → soil washed away {_num(m[2])} %",
    ),
    (
        rf"^Снова {C}: {C} → {C} — больше вредителей и болезней, урожай {N} %$",
        lambda m: (
            f"{_w(m[1]).capitalize()} again: {_w(m[2])} → {_w(m[3])} — more pests and diseases, yield {_num(m[4])} %"
        ),
    ),
    (
        rf"^Год (\d+): бобовые после бобовых \({C} → {C}\)$",
        lambda m: f"Year {m[1]}: legume after legume ({_w(m[2])} → {_w(m[3])})",
    ),
    (
        rf"^Год (\d+): {C} — перерыв для семейства «{C}» (\d+) г\., нужно не меньше (\d+) г\.$",
        lambda m: (
            f"Year {m[1]}: {_w(m[2])} — break for the {_w(m[3])} family {m[4]} yr, needs at least {m[5]} yr"
        ),
    ),
    (
        rf"^Год (\d+): покровная {C} из того же семейства, что {C}$",
        lambda m: (
            f"Year {m[1]}: cover {_w(m[2]).lower()} is in the same family as {_w(m[3]).lower()}"
        ),
    ),
    (
        r"^Год (\d+): поле весь год без растений$",
        lambda m: f"Year {m[1]}: no plants on the field all year",
    ),
    # captions
    (
        rf"^Год (\d+), ([а-я]+): \+(\d+) °C на ([а-я]+) — урожай {C} {N} %$",
        lambda m: (
            f"Year {m[1]}, {MONTHS.get(m[2], m[2])}: +{m[3]} °C at {STAGES.get(m[4], m[4])} — {_w(m[5])} yield {_num(m[6])} %"
        ),
    ),
    (
        rf"^Год (\d+), ([а-я]+): ливень (\d+) мм, {C} удержала почву$",
        lambda m: (
            f"Year {m[1]}, {MONTHS.get(m[2], m[2])}: {m[3]} mm downpour, {_w(m[4])} held the soil"
        ),
    ),
    (
        rf"^Год (\d+), ([а-я]+): ливень (\d+) мм на голую почву — смыло ≈ {N} т/га$",
        lambda m: (
            f"Year {m[1]}, {MONTHS.get(m[2], m[2])}: {m[3]} mm downpour on bare soil — ≈ {_num(m[4])} t/ha washed away"
        ),
    ),
    (
        rf"^Год (\d+), ([а-я]+): урожай {C} {N} т/га — на (\d+) % (выше|ниже) обычного$",
        lambda m: (
            f"Year {m[1]}, {MONTHS.get(m[2], m[2])}: {_w(m[3])} yield {_num(m[4])} t/ha — {m[5]} % {'above' if m[6] == 'выше' else 'below'} normal"
        ),
    ),
    (
        rf"^Год (\d+), ([а-я]+): {C}: заморозок {N} °C — гибель посевов$",
        lambda m: (
            f"Year {m[1]}, {MONTHS.get(m[2], m[2])}: {_w(m[3])}: frost {_num(m[4])} °C — the crop died"
        ),
    ),
    # cover crop timing
    (
        rf"^Заделать {C} до (\d\d)\.(\d\d) — за 2–3 недели до сева: {C} сеют (\d\d)\.(\d\d)(, иначе покровная заберёт весеннюю влагу)?$",
        lambda m: (
            f"Turn in the {_w(m[1])} by {m[2]}.{m[3]} — 2–3 weeks before sowing: {_w(m[4])} is sown {m[5]}.{m[6]}"
            + (", otherwise the cover takes the spring moisture" if m[7] else "")
        ),
    ),
    # salinity
    (
        r"^Риск засоления: проверьте дренаж; помогут промывка, капельный полив и глубококорневые культуры$",
        lambda m: (
            "Salinity risk: check the drainage; leaching, drip irrigation and deep-rooted crops help"
        ),
    ),
    (r"^тяжёлая почва \((\d+) % глины\)$", lambda m: f"heavy soil ({m[1]} % clay)"),
    (r"^сильное испарение \((\d+) мм в год\)$", lambda m: f"high evaporation ({m[1]} mm a year)"),
    (r"^полив по бороздам$", lambda m: "furrow irrigation"),
    (r"^много воды \((\d+) м³/га\)$", lambda m: f"much water ({m[1]} m³/ha)"),
    # passport
    (r"^Жарко летом$", lambda m: "Hot summers"),
    (r"^Умеренное лето$", lambda m: "Mild summers"),
    (r"^Жары почти не бывает$", lambda m: "Almost no heat"),
    (
        r"^в среднем (\d+) (?:день|дня|дней) в году выше 35 °C$",
        lambda m: f"on average {m[1]} days a year above 35 °C",
    ),
    (r"^дней выше 35 °C почти нет$", lambda m: "almost no days above 35 °C"),
    (r"^Мало дождей$", lambda m: "Little rain"),
    (r"^Дождей хватает не всегда$", lambda m: "Rain is not always enough"),
    (r"^Дождей много$", lambda m: "Plenty of rain"),
    (
        r"^(\d+) мм в год, больше всего — ([а-я]+) и ([а-я]+)$",
        lambda m: (
            f"{m[1]} mm a year, mostly in {SEASONS.get(m[2], m[2])} and {SEASONS.get(m[3], m[3])}"
        ),
    ),
    (r"^Почва подолгу голая$", lambda m: "Soil is often bare"),
    (r"^Почва чаще укрыта$", lambda m: "Soil is mostly covered"),
    (
        r"^голая около (\d+) дней в году(?:; ливни на голую почву — (.+))?$",
        lambda m: (
            f"bare about {m[1]} days a year" + (f"; downpours on bare soil: {m[2]}" if m[2] else "")
        ),
    ),
    (r"^Сильные ливни$", lambda m: "Heavy downpours"),
    (r"^Ливни нечасто$", lambda m: "Downpours are rare"),
    (
        r"^в среднем (\d+) (?:ливень|ливня|ливней) в год смывают голую почву; снимков со спутника для этого поля пока нет$",
        lambda m: (
            f"on average {m[1]} downpours a year wash bare soil; no satellite series for this field yet"
        ),
    ),
    (r"^Весенние заморозки$", lambda m: "Spring frosts"),
    (r"^Заморозков нет$", lambda m: "No frosts"),
    (
        r"^последний обычно до (\d+) ([а-я]+), в 1 году из 10 — до (\d+) ([а-я]+)$",
        lambda m: (
            f"the last one usually by {MONTHS_GEN.get(m[2], m[2])} {m[1]}, in 1 year out of 10 by {MONTHS_GEN.get(m[4], m[4])} {m[3]}"
        ),
    ),
    (r"^за (\d+) лет ни одного заморозка$", lambda m: f"not a single frost in {m[1]} years"),
    (r"^Жарких дней \(> 35 °C\): (.+)$", lambda m: "Hot days (> 35 °C): " + _trend(m[1])),
    (r"^Осадков за год: (.+)$", lambda m: "Rain per year: " + _trend(m[1])),
    (r"^Морозных дней: (.+)$", lambda m: "Frost days: " + _trend(m[1])),
    (r"^Погода за 20 лет — NASA POWER$", lambda m: "Weather for 20 years — NASA POWER"),
    (r"^Почва — SoilGrids$", lambda m: "Soil — SoilGrids"),
    (r"^Уклон (\d+) %$", lambda m: f"Slope {m[1]} %"),
    (r"^Уклон$", lambda m: "Slope"),
    (r"^Снимки со спутника$", lambda m: "Satellite images"),
    (
        r"^засуха (.+)$",
        lambda m: "drought in " + ", ".join(SEASONS.get(x, x) for x in m[1].split(", ")),
    ),
    (
        r"^жара в (.+)$",
        lambda m: "heat in " + ", ".join(MONTHS_LOC.get(x, x) for x in m[1].split(", ")),
    ),
    (r"^(\d+) сильных ливней$", lambda m: f"{m[1]} heavy downpours"),
    (r"^спокойный год$", lambda m: "a calm year"),
    # units, trend labels, work calendar
    (r"^\$/га в год$", lambda m: "$/ha a year"),
    (r"^% неурожайных$", lambda m: "% failed"),
    (r"^из 100$", lambda m: "of 100"),
    (r"^м³/га в год$", lambda m: "m³/ha a year"),
    (r"^% потребности$", lambda m: "% of need"),
    (r"^Жарких дней \(> 35 °C\)$", lambda m: "Hot days (> 35 °C)"),
    (r"^Осадков за год$", lambda m: "Rain per year"),
    (r"^Морозных дней$", lambda m: "Frost days"),
    (rf"^Сев: {C}$", lambda m: f"Sowing: {_w(m[1])}"),
    (rf"^Сев покровной: {C}$", lambda m: f"Sowing the cover: {_w(m[1])}"),
    (r"^Критический период: полив и жара$", lambda m: "Critical period: irrigation and heat"),
    (r"^Критический период: жара и засуха$", lambda m: "Critical period: heat and drought"),
    (r"^Уборка$", lambda m: "Harvest"),
    (r"^Заделка покровной$", lambda m: "Turning in the cover"),
    # field picture
    (r"^Свежий снимок$", lambda m: "Fresh image"),
    (
        r"^Свежий снимок закрыт облаками или ещё не найден\. Показываем мозаику за 2024 год$",
        lambda m: "The fresh image is cloudy or not found yet. Showing the 2024 mosaic",
    ),
    (
        r"^Снимок временно недоступен, данные анализа не зависят от него$",
        lambda m: "Image unavailable for now; the analysis does not depend on it",
    ),
    (
        r"^Карта зелени есть только у свежего снимка$",
        lambda m: "The greenness map exists only for a fresh image",
    ),
    (r"^Сохранённый снимок демо-поля$", lambda m: "Saved image of the demo field"),
    (r"^Снимок сохранён заранее$", lambda m: "Image saved in advance"),
    (r"^Схема$", lambda m: "Sketch"),
    (
        r"^Безоблачная мозаика Sentinel-2 \(EOX, 2024\)$",
        lambda m: "Cloudless Sentinel-2 mosaic (EOX, 2024)",
    ),
    # checklist of the summary
    (
        r"^Анализ почвы: pH, азот, фосфор, калий, органика \(0–30 см\), отбор по всему полю\.$",
        lambda m: (
            "Soil test: pH, nitrogen, phosphorus, potassium, organic matter (0–30 cm), sampled across the field."
        ),
    ),
    (
        r"^Засолённость \(электропроводность\) — особенно на орошаемых землях\.$",
        lambda m: "Salinity (electrical conductivity) — especially on irrigated land.",
    ),
    (
        r"^Дренаж и уровень грунтовых вод весной и после поливов\.$",
        lambda m: "Drainage and groundwater level in spring and after irrigation.",
    ),
    (
        r"^История вредителей и болезней на поле за 3–5 лет\.$",
        lambda m: "Pest and disease history of the field for 3–5 years.",
    ),
    (
        r"^Местные сорта и принятые сроки сева\.$",
        lambda m: "Local varieties and usual sowing dates.",
    ),
    (
        r"^Качество и доступность поливной воды, лимиты и график подачи\.$",
        lambda m: "Quality and availability of irrigation water, limits and delivery schedule.",
    ),
    (
        r"^Уклоны, промоины и места застоя воды — осмотр на месте\.$",
        lambda m: "Slopes, gullies and waterlogged spots — inspect on site.",
    ),
    (
        r"^Это инструмент поддержки решений, а не замена агроному\.$",
        lambda m: "This is a decision-support tool, not a replacement for an agronomist.",
    ),
    # deck hints
    (r"^Даёт азот следующей культуре$", lambda m: "Leaves nitrogen for the next crop"),
    (r"^Закрывает почву между сезонами$", lambda m: "Covers the soil between seasons"),
    (r"^Глубокие корни рыхлят почву$", lambda m: "Deep roots loosen the soil"),
    (r"^Пьёт много воды$", lambda m: "Drinks a lot of water"),
    (r"^Пьёт мало воды$", lambda m: "Drinks little water"),
    (r"^Не чаще раза в (\d+) года$", lambda m: f"Not more often than once in {m[1]} years"),
    (r"^Основная культура$", lambda m: "Main crop"),
    (r"^много$", lambda m: "high"),
    (r"^мало$", lambda m: "low"),
    (r"^средне$", lambda m: "medium"),
    # advice
    (
        r"^План под ваши приоритеты: (.+)$",
        lambda m: (
            "A plan for your priorities: "
            + " and ".join(
                {"вода": "water", "доход": "income", "почва": "soil", "риск": "risk"}.get(x, x)
                for x in m[1].split(" и ")
            )
        ),
    ),
    (r"^Не нашлось схемы под эти ограничения$", lambda m: "No plan fits these limits"),
    (
        rf"^{C} здесь, потому что (.+)\.$",
        lambda m: f"{_w(m[1])} here because " + _reason(m[2]) + ".",
    ),
    (
        rf"^{C} после уборки закрывает почву( и добавляет азот)?\.$",
        lambda m: (
            f"{_w(m[1])} after harvest covers the soil"
            + (" and adds nitrogen" if m[2] else "")
            + "."
        ),
    ),
    (
        r"^Урожаи, цены и вредители — оценки модели, а не прогноз для вашего хозяйства\.$",
        lambda m: "Yields, prices and pests are model estimates, not a forecast for your farm.",
    ),
]
COMPILED = [(re.compile(p), f) for p, f in PATTERNS]


def _trend(t: str) -> str:
    m = re.match(r"было (.+?) в (\d+–\d+), стало (.+?) в (\d+–\d+)(?: \(([−+]\d+) %\))?$", t)
    if m:
        return (
            f"was {_num(m[1]).replace(' мм', ' mm')} in {m[2]}, now {_num(m[3]).replace(' мм', ' mm')} in {m[4]}"
            + (f" ({_num(m[5])} %)" if m[5] else "")
        )
    m = re.match(r"почти без изменений \((.+?) в (\d+–\d+), (.+?) в (\d+–\d+)\)$", t)
    if m:
        return f"almost unchanged ({_num(m[1]).replace(' мм', ' mm')} in {m[2]}, {_num(m[3]).replace(' мм', ' mm')} in {m[4]})"
    return t


def _reason(t: str) -> str:
    parts = []
    for p in t.split(", "):
        m = re.match(r"даёт азот культуре следующего года \((.+)\)", p)
        if m:
            parts.append(f"it leaves nitrogen for next year's crop ({_w(m[1])})")
            continue
        m = re.match(r"сменяет семейство \((.+) → (.+)\) — меньше вредителей", p)
        if m:
            parts.append(f"it changes the family ({_w(m[1])} → {_w(m[2])}) — fewer pests")
            continue
        m = re.match(r"пьёт примерно на (\d+) % меньше воды", p)
        if m:
            parts.append(f"it drinks about {m[1]} % less water")
            continue
        m = re.match(r"чем самая влаголюбивая культура \((.+)\)", p)
        if m:
            parts.append(f"than the thirstiest crop ({_w(m[1])})")
            continue
        parts.append(p)
    return ", ".join(parts).replace(", than", " than")


def en(text: str) -> str:
    for rx, f in COMPILED:
        m = rx.match(text)
        if m:
            return f(m)
    return text


TEXT_KEYS = {
    "text",
    "title",
    "label",
    "hint",
    "main",
    "cover",
    "note",
    "estimate_note",
    "water",
    "unit",
}


def translate(obj: Any, lang: str, key: str | None = None) -> Any:
    """Translate the server's sentences inside an API answer."""
    if lang not in ("en", "tg"):
        return obj
    if isinstance(obj, dict):
        out = {k: translate(v, lang, k) for k, v in obj.items()}
        if isinstance(obj.get("names"), dict):
            out["names"] = {k: names(lang).get(k, v) for k, v in obj["names"].items()}
        cid = obj.get("id", obj.get("crop"))
        if cid in CROPS and "name_ru" in obj:
            out["name_ru"] = CROPS[cid][1 if lang == "en" else 2]
        if lang == "en" and "family_ru" in obj:
            out["family_ru"] = _w(obj["family_ru"])
        return out
    if isinstance(obj, list):
        return [translate(v, lang, key) for v in obj]
    if (
        isinstance(obj, str)
        and lang == "en"
        and (
            key in TEXT_KEYS
            or key in ("reasons", "notes", "hints", "checklist", "disclaimer")
            or key is None
        )
    ):
        return en(obj)
    return obj


def field_text(rec: dict[str, Any], lang: str) -> dict[str, Any]:
    """A field record with its name, region, card and story in `lang` when the seed has them."""
    t = (rec.get("i18n") or {}).get(lang)
    out = {k: v for k, v in rec.items() if k != "i18n"}
    if t:
        out |= {"name": t.get("name", rec["name"]), "region": t.get("region", rec.get("region"))}
        out |= {
            "card_ru": t.get("card", rec.get("card_ru")),
            "story_ru": t.get("story", rec.get("story_ru")),
        }
        out["note"] = t.get("note", rec.get("note"))
    elif lang == "en" and rec.get("note"):
        out["note"] = "Your field"
    return out


def names(lang: str) -> dict[str, str]:
    i = {"ru": 0, "en": 1, "tg": 2}.get(lang, 0)
    return {k: v[i] for k, v in CROPS.items()}
