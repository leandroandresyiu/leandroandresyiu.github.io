// Qué símbolos tiene cada tipografía del texto (para elegir con cuál se dibuja cada letra).
// "LM Roman 10" es la letra recta; "CMU Serif Italic" es la cursiva y además trae las letras griegas minúsculas
// (α, ω, τ…) que la recta no tiene: en las fórmulas de TeX las letras griegas van en cursiva, así que queda parecido.
// Rangos en hexadecimal sacados de las tablas de las tipografías de public/compartido/fonts.
const RANGOS_RECTA = '20-7e,a0-ac,ae-137,139-148,14a-165,168-17f,18e,192,1a0-1a1,1af-1b0,1dd,1e6-1e7,1ea-1eb,1f4-1f5,1fa-201,204-205,208-209,20c-20d,210-211,214-215,218-21b,258-259,2be-2bf,2c6-2c7,2d8-2dd,300-304,306-30c,30f,311,323,326,32e-332,393-394,398,39b,39e,3a0,3a3,3a5-3a6,3a8-3a9,e3f,1e0c-1e0f,1e24-1e27,1e2a-1e2b,1e36-1e39,1e42-1e47,1e58-1e5d,1e62-1e63,1e6c-1e6f,1e80-1e85,1e92-1e93,1e97,1ea0-1ef9,2013-2014,2016,2018-201a,201c-201e,2020-2022,2026,2030-2031,2039-203b,203d,2044-2046,2052,20a1,20a4,20a6,20a9,20ab-20ac,20b1,2103,2116-2117,211e,2120,2122,2126-2127,212e,2190-2193,2212,2215,2217,221a,221e,2222,2300,2329-232a';
const RANGOS_CURSIVA = '20-7e,a0-a3,a5,a7-b1,b4-b8,ba-bb,bf-d6,d8-113,116-121,124-125,12a-12b,130-131,134-135,139-13a,13d-13e,141-144,147-148,150-155,158-165,16a-171,178-17e,192,218-21b,2c6-2c7,2d8-2dd,374-375,37a,37e,384-38a,38c,38e-3a1,3a3-3ce,3d1,3d8-3dd,3df-3e1,400-477,47a-486,488-4c9,4cb-4ce,4d0-4f9,4fc-4ff,2000-200d,2010-2014,2016,2018-2022,2026,2029,202f-2031,2039-203b,203d,203f-2040,2044-2046,2052,2054,205f,20a1,20a4,20a6,20a9,20ab-20ac,20b2,2122,2206,221a';

const leer = (s) =>
	s.split(',').map((r) => {
		const [a, b] = r.split('-');
		return [parseInt(a, 16), parseInt(b ?? a, 16)];
	});
const RECTA = leer(RANGOS_RECTA);
const CURSIVA = leer(RANGOS_CURSIVA);
const tiene = (rangos, c) => rangos.some(([a, b]) => c >= a && c <= b);

/** ¿Hay que dibujar esta letra en cursiva? (la cursiva se pide, o la recta no la tiene pero la cursiva sí). */
export function esCursiva(ch, cursiva) {
	const c = ch.codePointAt(0);
	if (cursiva) return tiene(CURSIVA, c) || !tiene(RECTA, c);
	return !tiene(RECTA, c) && tiene(CURSIVA, c);
}

/** Parte una línea de texto en tramos de la misma tipografía: [{ s, it }]. */
export function trozos(linea, cursiva = false) {
	const out = [];
	for (const ch of linea) {
		const it = esCursiva(ch, cursiva);
		const u = out[out.length - 1];
		if (u && u.it === it) u.s += ch;
		else out.push({ s: ch, it });
	}
	return out;
}
