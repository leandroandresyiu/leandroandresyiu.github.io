"""kumolib: lo que py snippets le agrega a Python para trabajar con circuitos.

Del esquema de LTspice (.asc) a la función transferencia, las impedancias y los gráficos:

    c = cargar_asc("mi_circuito.asc")      # lee el esquema y calcula el punto de operación
    H = c.H("V1", "OUT")                   # transferencia de la fuente V1 al nodo OUT (Lcapy, simbólica)
    Z = c.Z_visto("B", hacia="Q1")         # impedancia que se ve desde el nodo B hacia el transistor
    bode(H)

Los transistores se reemplazan por su modelo de pequeña señal en el punto de operación. Todo es lineal:
las fuentes de continua pasan a cortocircuito y las de corriente continua a circuito abierto.

Usa Lcapy (LGPL), SymPy, NumPy, SciPy y Matplotlib. Código propio de kumOS.
"""
from __future__ import annotations

import math
import re
import warnings

import numpy as np
import sympy as sp
from scipy import signal

VT = 0.025852  # tensión térmica a 300 K

__all__ = [
    "cargar_asc", "Circuito", "bonito", "a_lti", "bode", "polos_ceros", "escalon", "impulso",
    "mostrar", "evaluar", "RESULTADO_RICO", "Hz", "s",
]
s = sp.Symbol("s")


# ------------------------------------------------------------------------------------------------ valores
_SUFIJOS = {"meg": 1e6, "mil": 25.4e-6, "t": 1e12, "g": 1e9, "k": 1e3, "m": 1e-3, "u": 1e-6, "µ": 1e-6, "μ": 1e-6, "n": 1e-9, "p": 1e-12, "f": 1e-15}


def valor(texto) -> float:
    """'4.7k' → 4700.0; '10uF' → 1e-05; 'meg' es mega y 'm' es mili (como en SPICE)."""
    if isinstance(texto, (int, float)):
        return float(texto)
    t = str(texto).strip().replace(",", ".")
    m = re.match(r"^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*(meg|mil|[tgkmunpfµμ])?", t, re.I)
    if not m:
        raise ValueError(f"No entiendo el valor '{texto}' (¿usa un parámetro {{...}}? Escribí el número directamente en el esquema)")
    num = float(m.group(1))
    suf = (m.group(2) or "").lower()
    return num * _SUFIJOS.get(suf, 1.0)


def Hz(f):
    """Pulsación ω = 2πf."""
    return 2 * np.pi * np.asarray(f)


# ------------------------------------------------------------------------------------------------ lectura del .asc
_PINES = {
    "res": [(16, 16), (16, 96)],
    "cap": [(16, 0), (16, 64)],
    "ind": [(16, 16), (16, 96)],
    "voltage": [(0, 16), (0, 96)],
    "current": [(0, 0), (0, 80)],
    "npn": [(16, 0), (0, 32), (16, 64)],  # colector, base, emisor
    "pnp": [(16, 64), (0, 32), (16, 0)],  # colector, base, emisor (el pnp está dibujado al revés)
    "opamp": [(-32, 48), (-32, 80), (32, 64)],  # entrada −, entrada +, salida
}
_TIPOS = {"res": "R", "cap": "C", "ind": "L", "voltage": "V", "current": "I", "npn": "Q", "pnp": "Q", "opamp": "U"}


def _girar(rot, x, y):
    if rot == "R0":
        return x, y
    if rot == "R90":
        return -y, x
    if rot == "R180":
        return -x, -y
    if rot == "R270":
        return y, -x
    if rot == "M0":
        return -x, y
    if rot == "M180":
        return x, -y
    if rot == "M90":  # espejo y giro de 90° (como lo hace LTspice)
        return _girar("R90", -x, y)
    if rot == "M270":
        return _girar("R270", -x, y)
    raise ValueError(f"Giro no soportado: {rot}")


def _en_segmento(p, a, b):
    (x, y), (x1, y1), (x2, y2) = p, a, b
    if (x2 - x1) * (y - y1) != (y2 - y1) * (x - x1):
        return False
    return min(x1, x2) <= x <= max(x1, x2) and min(y1, y2) <= y <= max(y1, y2)


class _Uf:
    def __init__(self):
        self.p = {}

    def f(self, a):
        self.p.setdefault(a, a)
        while self.p[a] != a:
            self.p[a] = self.p[self.p[a]]
            a = self.p[a]
        return a

    def u(self, a, b):
        self.p[self.f(a)] = self.f(b)


def _limpiar_nodo(n: str) -> str:
    return re.sub(r"[^0-9A-Za-z_]", "_", n)


def _leer_modelos(textos):
    modelos = {}
    juntos = []
    for t in textos:
        for ln in t.replace("\\n", "\n").split("\n"):
            if ln.startswith("+") and juntos:
                juntos[-1] += " " + ln[1:]
            else:
                juntos.append(ln)
    for ln in juntos:
        m = re.match(r"\s*\.model\s+(\S+)\s+(npn|pnp)\s*\(?(.*?)\)?\s*$", ln, re.I)
        if not m:
            continue
        par = {}
        for k, v in re.findall(r"(\w+)\s*=\s*(\S+?)(?=\s|\)|$)", m.group(3)):
            try:
                par[k.upper()] = valor(v)
            except ValueError:
                pass
        par["_tipo"] = m.group(2).lower()
        modelos[m.group(1).lower()] = par
    return modelos


class _Comp:
    """Un componente del circuito plano (ya con las resistencias internas del transistor separadas)."""

    def __init__(self, tipo, nombre, nodos, valor=None, **extra):
        self.tipo, self.nombre, self.nodos, self.valor = tipo, nombre, list(nodos), valor
        self.extra = extra
        self.padre = extra.pop("padre", nombre)

    def __repr__(self):
        return f"{self.tipo} {self.nombre} {self.nodos} {self.valor}"


def _modelo_bjt(par):
    d = {"IS": 1e-16, "BF": 100.0, "BR": 1.0, "VAF": math.inf, "RB": 0.0, "RC": 0.0, "RE": 0.0, "CJE": 0.0, "CJC": 0.0,
         "TF": 0.0, "TR": 0.0, "VJE": 0.75, "VJC": 0.75, "MJE": 0.33, "MJC": 0.33, "FC": 0.5}
    d.update({k: v for k, v in par.items() if not k.startswith("_")})
    if d["VAF"] <= 0:
        d["VAF"] = math.inf
    return d


def _corrientes_bjt(m, vbe, vbc):
    """Corrientes del transistor npn (en el sentido npn): (ic, ib) hacia colector y base."""
    IS, BF, BR, VAF = m["IS"], m["BF"], m["BR"], m["VAF"]
    ebe = math.exp(min(vbe / VT, 80.0))
    ebc = math.exp(min(vbc / VT, 80.0))
    ict = IS * (ebe - ebc) * (1 - vbc / VAF if math.isfinite(VAF) else 1.0)
    ib = IS / BF * (ebe - 1) + IS / BR * (ebc - 1)
    ic = ict - IS / BR * (ebc - 1)
    return ic, ib


def _jacobiano_bjt(m, vbe, vbc):
    """(a, b, c, d) con ic = a·vbe + b·vbc y ib = c·vbe + d·vbc en pequeña señal (derivadas centradas)."""
    h = 1e-7
    f = lambda x, y: _corrientes_bjt(m, x, y)
    ic1, ib1 = f(vbe + h, vbc)
    ic2, ib2 = f(vbe - h, vbc)
    ic3, ib3 = f(vbe, vbc + h)
    ic4, ib4 = f(vbe, vbc - h)
    return (ic1 - ic2) / (2 * h), (ic3 - ic4) / (2 * h), (ib1 - ib2) / (2 * h), (ib3 - ib4) / (2 * h)


def _cap_union(c0, v, vj, mj, fc):
    """Capacidad de juntura de SPICE (con la continuación lineal pasado FC·VJ)."""
    if c0 == 0:
        return 0.0
    if v < fc * vj:
        return c0 / (1 - v / vj) ** mj
    return c0 * (1 - fc) ** (-(1 + mj)) * (1 - fc * (1 + mj) + mj * v / vj)


# ------------------------------------------------------------------------------------------------ el circuito
class Circuito:
    """Circuito leído de un esquema. Se crea con cargar_asc()."""

    def __init__(self, comps, avisos, nombre="circuito"):
        self.nombre = nombre
        self.avisos = avisos
        self.comps: list[_Comp] = comps
        self.op: dict = {}
        self._cache = {}
        self._resolver_op()
        for a in avisos:
            warnings.warn(a, stacklevel=3)

    # ---------------------------------------------------------------- punto de operación
    def _nodos(self):
        n = []
        for c in self.comps:
            for x in c.nodos:
                if x != "0" and x not in n:
                    n.append(x)
        return n

    def _resolver_op(self):
        comps = self.comps
        nodos = self._nodos()
        idx = {n: i for i, n in enumerate(nodos)}
        ramas = [c for c in comps if c.tipo in ("V", "L", "OP")]
        N, M = len(nodos), len(ramas)
        bidx = {c.nombre: N + i for i, c in enumerate(ramas)}

        def k(n):
            return idx.get(n, -1)

        def armar(escala):
            A = np.zeros((N + M, N + M))
            b = np.zeros(N + M)
            for i in range(N):
                A[i, i] += 1e-12  # gmin
            for c in comps:
                t = c.tipo
                if t in ("R", "C", "L", "V", "I", "OP"):
                    pass
                if t == "R":
                    g = 1 / c.valor
                    a, bb = k(c.nodos[0]), k(c.nodos[1])
                    for p, q, sg in ((a, a, 1), (bb, bb, 1), (a, bb, -1), (bb, a, -1)):
                        if p >= 0 and q >= 0:
                            A[p, q] += sg * g
                elif t in ("V", "L"):
                    r = bidx[c.nombre]
                    a, bb = k(c.nodos[0]), k(c.nodos[1])
                    if a >= 0:
                        A[a, r] += 1
                        A[r, a] += 1
                    if bb >= 0:
                        A[bb, r] -= 1
                        A[r, bb] -= 1
                    b[r] = (c.extra.get("dc", 0.0) * escala) if t == "V" else 0.0
                elif t == "I":
                    a, bb = k(c.nodos[0]), k(c.nodos[1])
                    i = c.extra.get("dc", 0.0) * escala
                    if a >= 0:
                        b[a] -= i
                    if bb >= 0:
                        b[bb] += i
                elif t == "OP":  # amplificador ideal: V(out) = A·(V+ − V−) con A muy grande
                    r = bidx[c.nombre]
                    ent_n, ent_p, sal = k(c.nodos[0]), k(c.nodos[1]), k(c.nodos[2])
                    G = 1e9
                    if sal >= 0:
                        A[sal, r] += 1
                        A[r, sal] += 1
                    if ent_p >= 0:
                        A[r, ent_p] -= G
                    if ent_n >= 0:
                        A[r, ent_n] += G
            return A, b

        bjts = [c for c in comps if c.tipo == "Q"]

        def residuo(x, A, b):
            F = A @ x - b
            J = A.copy()
            for q in bjts:
                sg = q.extra["signo"]
                ic_, ib_, j = self._bjt_en(q, x, k)
                C, B, E = (k(n) for n in q.nodos)
                a_, b_, c_, d_ = j
                Ic, Ib = sg * ic_, sg * ib_
                for nodo, val, der in ((C, Ic, {B: a_ + b_, C: -b_, E: -a_}), (B, Ib, {B: c_ + d_, C: -d_, E: -c_}),
                                       (E, -(Ic + Ib), {B: -(a_ + b_ + c_ + d_), C: b_ + d_, E: a_ + c_})):
                    if nodo >= 0:
                        F[nodo] += val
                        for col, dv in der.items():
                            if col >= 0:
                                J[nodo, col] += dv
            return F, J

        def newton(x, escala, iteraciones=200):
            A, b = armar(escala)
            for _ in range(iteraciones):
                F, J = residuo(x, A, b)
                try:
                    dx = np.linalg.solve(J, -F)
                except np.linalg.LinAlgError:
                    return x, False
                # se limita el paso para que el exponencial de las junturas no se dispare
                alfa = 1.0
                for q in bjts:
                    C, B, E = (k(n) for n in q.nodos)
                    g = lambda v, i: v[i] if i >= 0 else 0.0
                    dvbe = abs(g(dx, B) - g(dx, E))
                    dvbc = abs(g(dx, B) - g(dx, C))
                    alfa = min(alfa, 0.15 / max(dvbe, dvbc, 1e-30))
                alfa = min(alfa, 1.0)
                x = x + alfa * dx
                if np.max(np.abs(dx)) * alfa < 1e-10 and alfa == 1.0:
                    return x, True
            return x, False

        x = np.zeros(N + M)
        x, ok = newton(x, 1.0)
        if not ok:  # se sube la tensión de las fuentes de a poco
            x = np.zeros(N + M)
            for esc in np.linspace(0.1, 1.0, 10):
                x, ok = newton(x, esc, 300)
        if not ok:
            raise RuntimeError("No pude encontrar el punto de operación (la continua no converge). Revisá que el circuito tenga una referencia a tierra (flag 0).")

        self.v = {n: float(x[i]) for n, i in idx.items()}
        self.v["0"] = 0.0
        self.i_fuente = {c.nombre: float(x[bidx[c.nombre]]) for c in ramas}
        self.bjt = {}
        for q in bjts:
            sg = q.extra["signo"]
            C, B, E = (k(n) for n in q.nodos)
            g = lambda i: x[i] if i >= 0 else 0.0
            vbe, vbc = sg * (g(B) - g(E)), sg * (g(B) - g(C))
            m = q.extra["modelo"]
            ic, ib = _corrientes_bjt(m, vbe, vbc)
            a, b, c, d = _jacobiano_bjt(m, vbe, vbc)
            gm = a + b
            datos = dict(Ic=sg * ic, Ib=sg * ib, Vbe=sg * vbe, Vce=sg * (vbe - vbc), gm=gm, gpi=c, gmu=d,
                         go=-b, rpi=1 / c if c > 0 else math.inf, ro=1 / (-b) if b < 0 else math.inf,
                         Cpi=m["TF"] * gm + _cap_union(m["CJE"], vbe, m["VJE"], m["MJE"], m["FC"]),
                         Cmu=_cap_union(m["CJC"], vbc, m["VJC"], m["MJC"], m["FC"]))
            self.bjt[q.padre] = {k: float(v) for k, v in datos.items()}
            self.bjt[q.padre].update(modelo=q.extra["modelo_nombre"], _abcd=tuple(float(v) for v in (a, b, c, d)))

    @staticmethod
    def _bjt_en(q, x, k):
        sg = q.extra["signo"]
        C, B, E = (k(n) for n in q.nodos)
        g = lambda i: x[i] if i >= 0 else 0.0
        vbe, vbc = sg * (g(B) - g(E)), sg * (g(B) - g(C))
        ic, ib = _corrientes_bjt(q.extra["modelo"], vbe, vbc)
        return ic, ib, _jacobiano_bjt(q.extra["modelo"], vbe, vbc)

    # ---------------------------------------------------------------- pequeña señal
    def _pequena_senal(self, activas=()):
        """Lista de componentes lineales de pequeña señal. `activas`: fuentes de tensión que se dejan (las demás se anulan)."""
        activas = set(activas)
        lista = []
        union = _Uf()
        for c in self.comps:
            if c.tipo == "V" and c.nombre not in activas:
                union.u(c.nodos[0], c.nodos[1])
        for c in self.comps:
            if c.tipo == "L" and c.valor == 0:
                union.u(c.nodos[0], c.nodos[1])

        def n(x):
            r = union.f(x)
            return r

        # la tierra manda como nombre del grupo
        grupos = {}
        for c in self.comps:
            for x in c.nodos:
                grupos.setdefault(union.f(x), []).append(x)
        nombre_de = {}
        for rep, miembros in grupos.items():
            if "0" in miembros:
                nombre_de[rep] = "0"
            else:
                nombre_de[rep] = sorted(miembros, key=lambda t: (t.startswith("N"), len(t)))[0]
        self._alias = {x: nombre_de[union.f(x)] for rep, miembros in grupos.items() for x in miembros}
        nn = lambda x: nombre_de[union.f(x)]

        for c in self.comps:
            t = c.tipo
            if t == "R" or t == "C" or (t == "L" and c.valor != 0):
                lista.append(_Comp(t, c.nombre, [nn(x) for x in c.nodos], c.valor, padre=c.padre))
            elif t == "V" and c.nombre in activas:
                lista.append(_Comp("V", c.nombre, [nn(x) for x in c.nodos], c.extra.get("ac", 1.0) or 1.0, padre=c.padre))
            elif t == "OP":
                lista.append(_Comp("OP", c.nombre, [nn(x) for x in c.nodos], padre=c.padre))
            elif t == "Q":
                p = self.bjt[c.padre]
                C, B, E = (nn(x) for x in c.nodos)
                a, b, cc, d = p["_abcd"]
                q = c.padre
                if cc > 0:
                    lista.append(_Comp("R", f"Rpi_{q}", [B, E], 1 / cc, padre=q))
                if d > 1e-15:
                    lista.append(_Comp("R", f"Rmu_{q}", [B, C], 1 / d, padre=q))
                lista.append(_Comp("G", f"Gm_{q}", [C, E, B, E], p["gm"], padre=q))
                if p["go"] > 1e-15:
                    lista.append(_Comp("R", f"Ro_{q}", [C, E], 1 / p["go"], padre=q))
                if p["Cpi"] > 0:
                    lista.append(_Comp("C", f"Cpi_{q}", [B, E], p["Cpi"], padre=q))
                if p["Cmu"] > 0:
                    lista.append(_Comp("C", f"Cmu_{q}", [B, C], p["Cmu"], padre=q))
        return lista

    @staticmethod
    def _a_netlist(lista):
        L = []
        for c in lista:
            t = c.tipo
            if t in ("R", "C", "L"):
                L.append(f"{c.nombre} {c.nodos[0]} {c.nodos[1]} {float(c.valor):.8g}")
            elif t == "V":
                L.append(f"{c.nombre} {c.nodos[0]} {c.nodos[1]} ac {float(c.valor):.8g}")
            elif t == "G":
                # Lcapy usa el signo contrario a SPICE en las fuentes controladas: se cambia el orden de la salida
                n1, n2, p, m = c.nodos
                L.append(f"{c.nombre} {n2} {n1} {p} {m} {float(c.valor):.8g}")
            elif t == "OP":
                ent_n, ent_p, sal = c.nodos
                L.append(f"E{c.nombre[1:] or c.nombre} {sal} 0 opamp {ent_p} {ent_n}")
        return "\n".join(L)

    @property
    def netlist(self) -> str:
        """Netlist de pequeña señal (todas las fuentes anuladas salvo las de señal)."""
        activas = [c.nombre for c in self.comps if c.tipo == "V" and c.extra.get("ac")]
        return self._a_netlist(self._pequena_senal(activas))

    def _cct(self, activas=(), quitar=(), cortos=()):
        from lcapy import Circuit as _C

        lista = self._pequena_senal(activas)
        lista = [c for c in lista if c.nombre not in quitar]
        txt = self._a_netlist(lista)
        for a, b in cortos:
            txt += f"\nW{a}{b} {a} {b}"
        return _C(txt)

    def _nodo(self, n):
        n = _limpiar_nodo(str(n))
        return getattr(self, "_alias", {}).get(n, n)

    def _puerto(self, x):
        """(n+, n−) de una fuente (por nombre) o de un nodo contra tierra."""
        if isinstance(x, (tuple, list)):
            return self._nodo(x[0]), self._nodo(x[1])
        for c in self.comps:
            if c.nombre.lower() == str(x).lower() and c.tipo == "V":
                return c.nodos[0], c.nodos[1]
        return self._nodo(x), "0"

    # ---------------------------------------------------------------- consultas
    def _ideal(self, x):
        """Lcapy deja la ganancia del amplificador operacional como un símbolo (E1): se pasa al límite de ganancia infinita."""
        nombres = {f"E{c.nombre[1:] or c.nombre}" for c in self.comps if c.tipo == "OP"}
        if not nombres:
            return x
        e = _expr(x)
        for sim in [q for q in e.free_symbols if q.name in nombres]:
            e = sp.limit(e, sim, sp.oo)
        return sp.simplify(e)

    def H(self, entrada, salida):
        """Función transferencia Vsalida/Ventrada (Lcapy, simbólica en s).
        entrada: nombre de una fuente de tensión ('V1'), un nodo ('IN') o un par ('A', 'B').
        salida: un nodo ('OUT') o un par de nodos ('A', 'B') para una tensión diferencial."""
        activa = [c.nombre for c in self.comps if c.tipo == "V" and c.nombre.lower() == str(entrada).lower()]
        self._pequena_senal(activa)  # fija los alias de nodos para esta consulta
        cct = self._cct(activa)
        ent = self._puerto(entrada)
        sal = self._puerto(salida)
        if activa:
            ent = tuple(self._alias.get(x, x) for x in ent)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            return self._ideal(cct.transfer(ent[0], ent[1], sal[0], sal[1]))

    def Z_visto(self, nodo, hacia=None, ref="0"):
        """Impedancia que se ve desde `nodo` (contra `ref`, por defecto tierra) con las fuentes anuladas.
        Si se indica `hacia` (nombre de un componente: 'R3', 'Q1'), solo cuenta esa rama: se sacan los demás
        componentes conectados a ese nodo. Ejemplo: c.Z_visto('B', hacia='Q1') es lo que ve la fuente mirando a la base."""
        self._pequena_senal(())
        n = self._nodo(nodo)
        quitar = set()
        if hacia is not None:
            h = str(hacia).lower()
            nombres_h = {c.padre for c in self.comps if c.padre.lower() == h or c.nombre.lower() == h}
            if not nombres_h:
                raise ValueError(f"No hay un componente llamado {hacia!r}. Los nombres son: {', '.join(sorted({c.padre for c in self.comps}))}")
            for c in self._pequena_senal(()):
                if n in c.nodos and c.padre not in nombres_h:
                    quitar.add(c.nombre)
        cct = self._cct((), quitar)
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                return self._ideal(cct.impedance(n, self._nodo(ref)))
        except Exception as e:
            raise RuntimeError(f"No pude calcular la impedancia en {nodo!r}: {e}. ¿Quedó alguna parte del circuito sin conexión a tierra después de sacar las otras ramas?") from None

    def Z(self, nodo_a, nodo_b):
        """Impedancia entre dos nodos con las fuentes anuladas."""
        self._pequena_senal(())
        cct = self._cct(())
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            return self._ideal(cct.impedance(self._nodo(nodo_a), self._nodo(nodo_b)))

    def tension_dc(self, nodo):
        """Tensión continua de un nodo en el punto de operación."""
        return self.v[_limpiar_nodo(str(nodo))]

    def __repr__(self):
        return f"<Circuito {self.nombre}: {len(self.comps)} componentes, {len(self.bjt)} transistor(es)>"

    def _repr_resumen(self):
        L = [f"Circuito «{self.nombre}»: {len({c.padre for c in self.comps})} componentes, {len(self._nodos())} nodos"]
        L.append("Tensiones continuas: " + ", ".join(f"{n} = {v:.4g} V" for n, v in sorted(self.v.items()) if n != "0"))
        for q, p in self.bjt.items():
            L.append(f"{q} ({p['modelo']}): Ic = {p['Ic']*1e3:.4g} mA, Vce = {p['Vce']:.4g} V, gm = {p['gm']*1e3:.4g} mS, rπ = {p['rpi']:.4g} Ω, ro = {p['ro']:.4g} Ω")
        return "\n".join(L)


def cargar_asc(origen, modelos=None, nombre=None) -> Circuito:
    """Lee un esquema de LTspice (.asc) y calcula su punto de operación.
    origen: nombre de un archivo (los .asc de Archivo y los que subís están disponibles) o el texto del .asc.
    modelos: parámetros de transistores que no estén en el esquema: {'2N3904': dict(IS=6.7e-15, BF=416, VAF=74)}."""
    if "\n" in str(origen) or str(origen).lstrip().startswith("Version"):
        texto, nombre = str(origen), nombre or "circuito"
    else:
        import os

        ruta = str(origen)
        cand = [ruta, os.path.join("/home/pyodide", ruta), os.path.join("/home/pyodide/archivos", os.path.basename(ruta))]
        encontrada = next((p for p in cand if os.path.exists(p)), None)
        if not encontrada:
            raise FileNotFoundError(f"No encuentro {ruta!r}. Guardalo en Archivo (carpeta «Circuitos LTspice») o subilo con el botón «Subir .asc».")
        with open(encontrada, encoding="utf-8", errors="replace") as f:
            texto = f.read()
        nombre = nombre or os.path.splitext(os.path.basename(ruta))[0]
    return _armar(texto, nombre, modelos or {})


def _armar(texto, nombre, modelos_usuario):
    cables, banderas, simbolos, textos, avisos = [], [], [], [], []
    actual = None
    for ln in texto.splitlines():
        p = ln.split()
        if not p:
            continue
        if p[0] == "WIRE":
            cables.append(tuple(map(int, p[1:5])))
        elif p[0] == "FLAG":
            banderas.append((int(p[1]), int(p[2]), " ".join(p[3:])))
        elif p[0] == "SYMBOL":
            actual = {"sim": p[1].replace("\\\\", "\\").split("\\")[-1].lower(), "x": int(p[2]), "y": int(p[3]), "rot": p[4] if len(p) > 4 else "R0", "nombre": "", "valor": "", "extra": ""}
            simbolos.append(actual)
        elif p[0] == "SYMATTR" and actual is not None:
            if p[1] == "InstName":
                actual["nombre"] = p[2]
            elif p[1] == "Value":
                actual["valor"] = " ".join(p[2:])
            elif p[1] == "SpiceLine":
                actual["extra"] = " ".join(p[2:])
        elif p[0] == "TEXT":
            if "!" in ln:
                textos.append(ln.split("!", 1)[1])
    if not simbolos:
        raise ValueError("El archivo no tiene componentes (¿es un .asc de LTspice?)")

    uf = _Uf()
    for a in cables:
        uf.u(a[:2], a[2:])
    puntos = []
    for sb in simbolos:
        tipo = sb["sim"]
        sb["pines_pos"] = []
        if tipo in _PINES:
            for px, py in _PINES[tipo]:
                dx, dy = _girar(sb["rot"], px, py)
                pt = (sb["x"] + dx, sb["y"] + dy)
                sb["pines_pos"].append(pt)
                puntos.append(pt)
    for x, y, _ in banderas:
        puntos.append((x, y))
    for pt in puntos:
        uf.f(pt)
        for a in cables:
            if _en_segmento(pt, a[:2], a[2:]):
                uf.u(pt, a[:2])
    nombres = {}
    for x, y, nom in banderas:
        nombres.setdefault(nom, []).append((x, y))
    for nom, pts in nombres.items():
        for q in pts[1:]:
            uf.u(pts[0], q)
    etiqueta = {}
    for nom, pts in nombres.items():
        etiqueta[uf.f(pts[0])] = "0" if nom == "0" else _limpiar_nodo(nom)
    cuenta = [0]

    def red(pt):
        r = uf.f(pt)
        if r not in etiqueta:
            cuenta[0] += 1
            etiqueta[r] = f"N{cuenta[0]:03d}"
        return etiqueta[r]

    modelos = _leer_modelos(textos)
    for k, v in modelos_usuario.items():
        modelos[str(k).lower()] = {**modelos.get(str(k).lower(), {}), **{a.upper(): b for a, b in v.items()}}

    comps = []
    for sb in simbolos:
        tipo = sb["sim"]
        nom = sb["nombre"] or f"X{len(comps)}"
        if tipo not in _PINES:
            avisos.append(f"El símbolo «{sb['sim']}» ({nom}) no está soportado y se ignora (soportados: resistencia, capacitor, inductor, fuentes, npn, pnp y amplificador operacional ideal).")
            continue
        nodos = [red(p) for p in sb["pines_pos"]]
        val = sb["valor"]
        if tipo in ("res", "cap", "ind"):
            c = _Comp({"res": "R", "cap": "C", "ind": "L"}[tipo], nom, nodos, valor(val))
            if c.valor == 0 and c.tipo == "R":
                avisos.append(f"{nom} vale 0 Ω: se tomó como 1 µΩ.")
                c.valor = 1e-6
            comps.append(c)
        elif tipo in ("voltage", "current"):
            dc, ac = 0.0, 0.0
            partes = re.sub(r"\s+", " ", val.strip())
            m = re.search(r"\bac\s+([-+0-9.eE]+[a-zA-Zµμ]*)", partes, re.I)
            if m:
                ac = valor(m.group(1))
                partes = partes[: m.start()] + partes[m.end():]
            m = re.match(r"^\s*(?:dc\s+)?([-+]?[0-9.]+(?:e[-+]?\d+)?[a-zA-Zµμ]*)\s*$", partes.strip(), re.I)
            if m:
                dc = valor(m.group(1))
            c = _Comp("V" if tipo == "voltage" else "I", nom, nodos, None, dc=dc, ac=ac)
            comps.append(c)
        elif tipo in ("npn", "pnp"):
            mod = val.strip() or tipo
            par = modelos.get(mod.lower())
            if par is None:
                par = {"_tipo": tipo}
                avisos.append(f"El modelo «{mod}» ({nom}) no está en el esquema: se usaron los valores por defecto de SPICE (IS=1e-16, BF=100). Pasalos con cargar_asc(..., modelos={{'{mod}': dict(IS=..., BF=..., VAF=...)}}).")
            m = _modelo_bjt(par)
            C, B, E = nodos
            # resistencias internas de base, colector y emisor (si el modelo las tiene)
            pc, pb, pe = C, B, E
            if m["RC"] > 0:
                pc = f"{nom}_c"
                comps.append(_Comp("R", f"Rc_{nom}", [C, pc], m["RC"], padre=nom))
            if m["RB"] > 0:
                pb = f"{nom}_b"
                comps.append(_Comp("R", f"Rb_{nom}", [B, pb], m["RB"], padre=nom))
            if m["RE"] > 0:
                pe = f"{nom}_e"
                comps.append(_Comp("R", f"Re_{nom}", [E, pe], m["RE"], padre=nom))
            comps.append(_Comp("Q", nom, [pc, pb, pe], None, signo=1 if tipo == "npn" else -1, modelo=m, modelo_nombre=mod, tipo_q=tipo))
        elif tipo == "opamp":
            comps.append(_Comp("OP", nom, nodos))
    return Circuito(comps, avisos, nombre)


# ------------------------------------------------------------------------------------------------ expresiones y gráficos
def _expr(H):
    """La expresión de SymPy de lo que sea (Lcapy, SymPy o número)."""
    if hasattr(H, "expr"):
        H = H.expr
    return sp.sympify(H)


def _var(e):
    fs = [x for x in e.free_symbols if x.name == "s"]
    return fs[0] if fs else s


def _coef(H):
    e = sp.cancel(sp.together(_expr(H)))
    v = _var(e)
    n, d = sp.fraction(e)
    pn, pd = sp.Poly(n, v), sp.Poly(d, v)
    return [float(c) for c in pn.all_coeffs()], [float(c) for c in pd.all_coeffs()]


def a_lti(H):
    """La transferencia como objeto scipy.signal.TransferFunction (para bode, step, lsim...)."""
    n, d = _coef(H)
    return signal.TransferFunction(n, d)


def bonito(H, cifras=4, normalizar=True):
    """La expresión con pocas cifras significativas y, si es una transferencia, con el denominador mónico.
    Sirve para leer y para mostrar; no para seguir calculando."""
    e = _expr(H)
    v = _var(e)
    if normalizar and v in e.free_symbols:
        try:
            n, d = sp.fraction(sp.cancel(sp.together(e)))
            pd = sp.Poly(d, v)
            lead = pd.LC()
            e = sp.Poly(n, v).as_expr() / lead / (pd.as_expr() / lead)
            n, d = sp.fraction(e)
            e = sp.Poly(sp.expand(n / 1), v).as_expr() / sp.Poly(sp.expand(d), v).as_expr()
        except Exception:
            pass
    return sp.N(e, cifras)


def evaluar(H, f):
    """H(j2πf) como número complejo para una frecuencia en Hz (o un arreglo de frecuencias). Con módulo y fase: abs(), np.angle(..., deg=True)."""
    n, d = _coef(H)
    w = 2j * np.pi * np.asarray(f, dtype=float)
    r = np.polyval(n, w) / np.polyval(d, w)
    return complex(r) if np.ndim(r) == 0 else r


def polos_ceros(H, mostrar_en_consola=True):
    """(ceros, polos) de la transferencia, en rad/s. Imprime también las frecuencias en Hz."""
    n, d = _coef(H)
    z = np.roots(n) if len(n) > 1 else np.array([])
    p = np.roots(d) if len(d) > 1 else np.array([])
    if mostrar_en_consola:
        f = lambda r: "  ".join(f"{x:.4g}" for x in r) or "—"
        print("Ceros  (rad/s):", f(z))
        print("Polos  (rad/s):", f(p))
        print("Polos  (Hz)   :", "  ".join(f"{abs(x)/(2*np.pi):.4g}" + ("" if abs(x.imag) < 1e-9 * max(abs(x), 1) else f"  (±j, ζ={-x.real/abs(x):.3g})") for x in p) or "—")
    return z, p


def _fig_estilo():
    import matplotlib

    matplotlib.rcParams.update({"figure.facecolor": "white", "axes.facecolor": "white", "font.size": 10, "axes.grid": True, "grid.alpha": 0.35,
                                "figure.dpi": 110, "axes.spines.top": False, "axes.spines.right": False})


def bode(H, fmin=None, fmax=None, puntos=600, fase=True):
    """Diagrama de Bode (módulo en dB y fase en grados) de una transferencia. fmin/fmax en Hz; si no se dan se eligen según los polos y ceros."""
    import matplotlib.pyplot as plt

    _fig_estilo()
    sys_ = a_lti(H)
    z, p = np.roots(sys_.num) if len(sys_.num) > 1 else [], np.roots(sys_.den) if len(sys_.den) > 1 else []
    rr = [abs(x) / (2 * np.pi) for x in list(z) + list(p) if abs(x) > 0]
    fmin = fmin or (min(rr) / 30 if rr else 1)
    fmax = fmax or (max(rr) * 30 if rr else 1e6)
    f = np.logspace(np.log10(fmin), np.log10(fmax), puntos)
    w, mag, ph = signal.bode(sys_, w=2 * np.pi * f)
    fig, ejes = plt.subplots(2 if fase else 1, 1, sharex=True, figsize=(7.2, 5.2 if fase else 3.2))
    ejes = np.atleast_1d(ejes)
    ejes[0].semilogx(f, mag, color="#d1370f", lw=1.8)
    ejes[0].set_ylabel("|H| [dB]")
    ejes[0].grid(True, which="both", alpha=0.3)
    if fase:
        ejes[1].semilogx(f, ph, color="#1b6fa8", lw=1.8)
        ejes[1].set_ylabel("fase [°]")
        ejes[1].grid(True, which="both", alpha=0.3)
    ejes[-1].set_xlabel("f [Hz]")
    fig.tight_layout()
    return fig


def escalon(H, tmax=None, puntos=800):
    """Respuesta al escalón unitario. tmax en segundos (si no se da, se elige según el polo más lento)."""
    return _temporal(H, "escalón", signal.step, tmax, puntos)


def impulso(H, tmax=None, puntos=800):
    """Respuesta al impulso."""
    return _temporal(H, "impulso", signal.impulse, tmax, puntos)


def _temporal(H, titulo, fn, tmax, puntos):
    import matplotlib.pyplot as plt

    _fig_estilo()
    sys_ = a_lti(H)
    if tmax is None:
        lentos = [abs(x.real) for x in np.roots(sys_.den) if abs(x.real) > 1e-12] if len(sys_.den) > 1 else []
        tmax = 6 / min(lentos) if lentos else 1.0
    t = np.linspace(0, tmax, puntos)
    t, y = fn(sys_, T=t)
    fig, ax = plt.subplots(figsize=(7.2, 3.6))
    ax.plot(t, y, color="#d1370f", lw=1.8)
    ax.set_xlabel("t [s]")
    ax.set_ylabel("salida")
    ax.set_title(f"Respuesta al {titulo}")
    fig.tight_layout()
    return fig


# ------------------------------------------------------------------------------------------------ cómo se muestran los resultados
class RESULTADO_RICO:
    """Marca para resultados con más de un formato (texto, latex, imagen)."""

    def __init__(self, tipo, dato):
        self.tipo, self.dato = tipo, dato


def mostrar(x):
    """Mostrar con formato (fórmulas, tablas). En una celda, el último valor se muestra solo."""
    from kumo_runtime import mostrar_obj

    mostrar_obj(x)
