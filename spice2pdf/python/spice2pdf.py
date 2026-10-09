"""Spice-a-PDF para kumOS.

Código del programa original de Teoría de Circuitos II (https://github.com/TC-II/Spice-a-PDF, Javier Petrucci y colaboradores),
con los cambios mínimos para que corra dentro del navegador (Pyodide). Cambios respecto del original (Main.py):
  - Sin instalación de librerías ni lectura de carpetas: recibe el texto del .asc y devuelve el SVG (ver convertir()).
  - Los símbolos (Skins/Default/*.svg) se incrustan dentro del SVG en vez de enlazarlos como imágenes, así el dibujo es
    autocontenido y se puede ajustar, mostrar o convertir a PDF sin archivos sueltos.
  - Los textos llevan una clase (nombre / valor / flag / comentario) para poder mostrarlos u ocultarlos.
  - Los símbolos que el programa no conoce ya no se saltean en silencio: se dibuja un recuadro y se avisa.
  - La lectura del .asc tolera líneas vacías o incompletas.
El resto (posiciones de los textos, unidades, giros y espejados de cada componente) es el original sin cambios.
"""
import os
import re
import xml.etree.ElementTree as ET

import svgwrite

# Definiciones del texto.
font = "LM Roman 10"
fontSize = "20px"

# Carpeta con los símbolos (en el navegador se copian a /app/Skins).
CARPETA_BASE = os.path.dirname(os.path.abspath(__file__))

minx = 0
miny = 0
windowsize = (1000, 1000)
wires = []
hay_rectangulo = False
desconocidos = []  # tipos de símbolo sin dibujo
skins_faltantes = []


class Component:
    def __init__(slf, component_type, position, orientation, flip, attributes, windows):
        # Constructor que inicializa el objeto "Component" con varios parámetros:
        # Cada "Component" Corresponde a un componente del esquemático (R, L, C, ...)
        # "component_type": tipo de componente.
        # "position": posición del componente en coordenadas (x, y).
        # "orientation": orientación del componente (x ej., "R0", "R90", "R180", "R270").
        # "flip": indicador de si el componente está espejado (flip = -1) o no (flip = 1).
        # "attributes": atributos adicionales del componente.
        # "windows": información relacionada con la alineación y ventanas de texto asociadas al componente (Es la forma que el Spice da la información de los textos de los componentes).
        slf.component_type = component_type
        slf.position = position
        slf.orientation = orientation
        slf.flip = flip
        slf.attributes = attributes
        slf.windows = windows

    def draw(slf, dwg):
        # Método abstracto para dibujar el componente en un objeto "dwg" (como un dibujo SVG).
        # Este método debe ser implementado por cada subclase, ya que cada componente lo genera de manera distinta, de otra manera lanza una excepción "NotImplementedError".
        raise NotImplementedError

    def adjust_coordinates_for_orientation_and_alignment(slf, x, y, alignment):
        # Ajusta las coordenadas (x, y) basadas en la orientación del componente y la alineación especificada.
        # Devuelve las coordenadas ajustadas.

        if alignment == "Left":
            if slf.orientation == "R0":
                y += 6.5
                return x, y
            elif slf.orientation == "R90":
                x += 7
                return -y, x
        elif alignment == "VTop":
            if slf.orientation == "R90":
                x += 22
            elif slf.orientation == "R270":
                x += 6
        elif alignment == "VBottom":
            if slf.orientation == "R90":
                x -= 6
            elif slf.orientation == "R270":
                x -= 18

        return slf.rotate_coordinates(x, y)

    def rotate_coordinates(slf, x, y):
        # Rota las coordenadas (x, y) en función de la orientación del componente.
        # Devuelve las coordenadas rotadas.

        if slf.orientation == "R0":
            return x, y
        elif slf.orientation == "R90":
            return -y, x
        elif slf.orientation == "R180":
            return -x, -y
        elif slf.orientation == "R270":
            return y, -x

    def add_text(slf, dwg, x, y, window, text, size=fontSize, angle=0, color = "#000000"):
        # Añade texto al dibujo "dwg" en la posición (x, y), con la alineación especificada por "window".
        # El texto se ajusta según la orientación, el espejado y el tamaño especificado.

        if (not (x == 25040.2 and y == -25040.2)) and text != '""':
            coords = slf.adjust_coordinates_for_orientation_and_alignment(
                window[0], window[1], window[2])
            if coords is None:
                raise ValueError(
                    "Coords cannot be None. Please check the window value.")
            # Si el texto debe estar alineado en la parte superior o inferior verticalmente:
            # if(slf.attributes["InstName"][0] == "L"):
            #print(slf.attributes["InstName"], window[2], slf.orientation, slf.flip)
                
            if window[2] in ["VTop", "VBottom"]:
                dwg.add(dwg.text(text, insert=(
                    x + (slf.flip) * coords[0], y + coords[1]), font_family=font, font_size=size, text_anchor="middle", fill=color, class_=_rol(slf, text)))
            else:
                # Crea un elemento de texto, ajustando la alineación según la orientación y el espejado:
                text_element = dwg.text(text, insert=(x + ((slf.flip) * coords[0]), y + coords[1]), class_=_rol(slf, text), font_family=font, font_size=size, text_anchor="end" if (
                    ((slf.orientation == "R90" or slf.orientation == "R180") and slf.flip == 1) or ((slf.orientation == "R0" or slf.orientation == "R270") and slf.flip == -1)) else "start")
                # Aplica una rotación al texto en función del ángulo especificado:
                text_element.rotate(-angle, center=(x +
                                    coords[0], y + coords[1]))
                dwg.add(text_element)

    def draw_image_with_rotation(slf, dwg, href):
        # Dibuja el símbolo ("skin") en el dibujo "dwg", aplicando rotación y/o espejado según sea necesario.
        # Original: lo enlazaba con <image href=...>; acá se incrusta su contenido (misma posición, giro y espejado).
        x, y = slf.position
        angle = int(slf.orientation[1:])
        # Original: si está espejado, scale(-1, 1) translate(-2x, 0) rotate(angle, x, y); si no, rotate(angle, x, y).
        # Se combinan en una sola matriz (más simple para quien convierte el SVG a PDF) y se le suma el desplazamiento (x, y).
        m = _rotar(angle, x, y)
        if slf.flip == -1:
            m = _mult((-1, 0, 0, 1, 0, 0), _mult((1, 0, 0, 1, -2 * x, 0), m))
        m = _mult(m, (1, 0, 0, 1, x, y))
        contenido = _skin_incrustado(href)
        if contenido is None:
            if href not in skins_faltantes:
                skins_faltantes.append(href)
            return
        matriz = ','.join(f'{v:.6g}' for v in m)
        dwg.add(svgwrite.Crudo(f'<g class="simbolo" data-tipo="{slf.component_type}" transform="matrix({matriz})">{contenido}</g>'))


class Amp_Current(Component):
    # Implementación de "draw". Es distinto para cada componente.
    def draw(slf, dwg):
        # Dibuja el componente a partir de un svg que se encuentra en la carpeta de "Skins".
        slf.draw_image_with_rotation(dwg, 'Skins/Default/Amp_Current.svg')

        # Añade el primer texto a partir de los parámetros:
        # "dwg" : Lienzo donde dibujar el componente.
        # "x" : Posición en el eje x del componente.
        # "y" : Posición en el eje y del componente.
        # "window" : Ventana donde se detallan las propiedades del label (x,y con respecto al componente, Valor, Orientación).
        # "text": Texto a imprimir.
        # "size" (optional): Tamaño a imprimir el texto. Por defecto es 20px.
        # "angle" (optional): Angulo con el cual se imprime el texto.

        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            0, (36, 40, "Left")), slf.attributes.get("InstName", ""), angle=(int(slf.orientation[1:])) % 180)

        # Añade el segundo texto a partir de los parámetros
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            3, (36, 76, "Left")), slf.attributes.get("Value", " "), angle=(int(slf.orientation[1:])) % 180)


class Amp_Transimpedance(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(
            dwg, 'Skins/Default/Amp_Transimpedance.svg')
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            0, (36, 40, "Left")), slf.attributes.get("InstName", ""), angle=(int(slf.orientation[1:])) % 180)
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            3, (36, 76, "Left")), slf.attributes.get("Value", " "), angle=(int(slf.orientation[1:])) % 180)

class Ampmeter(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/ampmeter.svg')
        # Se agrega un offset distinto a cada orientación.
        offset = offset_text(slf, 7, 0, -2, 0, slf.flip)

        slf.add_text(dwg, slf.position[0] + offset, slf.position[1] + offset, slf.windows.get(
            0, (-23, 14, "Left")), slf.attributes.get("InstName", ""), angle=90)


class Arrow(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/arrow.svg')
        # Se agrega un offset distinto a cada orientación. En este caso en el eje "x". En el eje x se aclara si está espejado.
        offsetx = offset_text(slf, 0, 0, 0, -1, slf.flip)
        # Se agrega un offset distinto a cada orientación. En este caso en el eje "y".
        offsety = offset_text(slf, 14, 10, 0, 2)
        slf.add_text(dwg, slf.position[0] + offsetx, slf.position[1] + offsety, slf.windows.get(
            3, (21, -18, "VTop")), slf.attributes.get("Value", "Ir"))


class Arrow_curve(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/arrow_curve.svg')
        offsetx = offset_text(slf, 3, 7, -3, -9, slf.flip)
        offsety = offset_text(slf, -1, 15, -7, -4)
        slf.add_text(dwg, slf.position[0] + offsetx, slf.position[1] + offsety,
                     slf.windows.get(3, (63, 55, "Left")), slf.attributes.get("Value", "Vr"))


class Arrow_Z(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/arrow_Z.svg')
        offsetx = offset_text(slf, -3, 7, 4, -6, slf.flip)
        offsety = offset_text(slf, 10, 10, 3, 2)
        slf.add_text(dwg, slf.position[0] + offsetx, slf.position[1] + offsety,
                     slf.windows.get(3, (21, -22, "Left")), slf.attributes.get("Value", "Zi"))

class Arrow_Z2(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/arrow_Z2.svg')
        offsetx = offset_text(slf, -3, 7, 4, -6, slf.flip)
        offsety = offset_text(slf, 10, 10, 3, 2)
        slf.add_text(dwg, slf.position[0] + offsetx, slf.position[1] + offsety,
                     slf.windows.get(3, (21, -22, "Left")), slf.attributes.get("Value", "Zi"))

class Bi(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/bi.svg')
        offsety = offset_text(slf, -15, 0, 18)
        offsety2 = offset_text(slf, -15, 0, -15)

        slf.add_text(dwg, slf.position[0], slf.position[1] + offsety, slf.windows.get(
            0, (36, 40, "Left")), slf.attributes.get("InstName", ""), angle=(int(slf.orientation[1:])) % 180)
        slf.add_text(dwg, slf.position[0], slf.position[1] + offsety2, slf.windows.get(
            3, (36, 76, "Left")), slf.attributes.get("Value", " "), angle=(int(slf.orientation[1:])) % 180)


class Bv(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/bv.svg')
        offsety = offset_text(slf, 0, 0, 18)
        slf.add_text(dwg, slf.position[0], slf.position[1] + offsety, slf.windows.get(
            0, (36, 40, "Left")), slf.attributes.get("InstName", ""), angle=(int(slf.orientation[1:])) % 180)
        slf.add_text(dwg, slf.position[0], slf.position[1] - offsety + 3, slf.windows.get(
            3, (36, 76, "Left")), slf.attributes.get("Value", " "), angle=(int(slf.orientation[1:])) % 180)


class Bypass(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/bypass.svg')


class Capacitor(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/cap.svg')
        slf.add_text(dwg, slf.position[0], slf.position[1] - 8, slf.windows.get(
            0, (24, 8, "Left")), slf.attributes.get("InstName", ""))
        # Si el valor es numérico se agrega la unidad#
        val = slf.attributes.get("Value", "C")
        # No verifica el último caracter porque puede ser pico micro mili, etc
        if all(char.isnumeric() or char == "." for char in val[:-1]):
            units = ["f", "p", "n", "µ", "u", "m",
                     "k", "F", "P", "N", "U", "M", "K"]
            # El último caracter es un número o alguna unidad
            if True in [val[-1] == units[i] for i in range(len(units))] or val[-1].isnumeric():
                val = val + "F"
        # Caso especial índice "MEG"
        if val[-3:].lower() == "meg":
            val = val + "F"

        slf.add_text(dwg, slf.position[0], slf.position[1] + 5, slf.windows.get(
            3, (24, 56, "Left")), val)


class Cell(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/cell.svg')
        offsetx = offset_text(slf, -5, 0, -2, slf.flip)
        offsety = offset_text(slf, 0, 0, 9)

        slf.add_text(dwg, slf.position[0] + offsetx, slf.position[1] + 6 + offsety,
                     slf.windows.get(0, (24, 8, "Left")), slf.attributes.get("InstName", ""))
        # Si el valor es numérico se agrega la unidad#
        val = slf.attributes.get("Value", " ")
        if all(char.isnumeric() or char == "." for char in val[:-1]):
            val = val + "V"
        slf.add_text(dwg, slf.position[0] + offsetx, slf.position[1] - 8 + offsety,
                     slf.windows.get(3, (24, 56, "Left")), val)


class Current(Component):
    def draw(slf, dwg):

        offset = offset_text(slf, 22, 0, -13, 0)
        offset3 = offset_text(slf, 22, 0, 13, 0)

        slf.draw_image_with_rotation(dwg, 'Skins/Default/current.svg')
        slf.add_text(dwg, slf.position[0], slf.position[1] - offset, slf.windows.get(
            0, (36, 40, "Left")), slf.attributes.get("InstName", ""))
        # Si el valor es numérico se agrega la unidad#
        val = slf.attributes.get("Value", " ")
        # No verifica el último caracter porque puede ser pico micro mili, etc
        if all(char.isnumeric() or char == "." for char in val[:-1]):
            units = ["f", "p", "n", "µ", "u", "m",
                     "k", "F", "P", "N", "U", "M", "K"]
            # El último caracter es un número o alguna unidad
            if True in [val[-1] == units[i] for i in range(len(units))] or val[-1].isnumeric():
                val = val + "A"
        # Caso especial índice "MEG"
        if val[-3:].lower() == "meg":
            val = val + "A"
        slf.add_text(dwg, slf.position[0], slf.position[1] - offset3, slf.windows.get(
            3, (36, 76, "Left")), slf.attributes.get("Value", " "))


class Diode(Component):
    def draw(slf, dwg):
        offsety = offset_text(slf, 0, 0, 0, 3)
        slf.draw_image_with_rotation(dwg, 'Skins/Default/diode.svg')
        slf.add_text(dwg, slf.position[0] + 1, slf.position[1] + 1, slf.windows.get(
            0, (24, 0, "Left")), slf.attributes.get("InstName", ""))
        slf.add_text(dwg, slf.position[0] + 3, slf.position[1] - 4 + offsety,
                     slf.windows.get(3, (24, 64, "Left")), slf.attributes.get("Value", " "))

class Dif(Component):
    def draw(slf, dwg):
        offsety = offset_text(slf, 0, 0, 0, 3)
        slf.draw_image_with_rotation(dwg, 'Skins/Default/dif.svg')

class Diode45(Component):
    def draw(slf, dwg):
        offsetx = offset_text(slf, -30, 18, -5, 35, slf.flip)
        offsety = offset_text(slf, -8, -30, -40, -15)

        slf.draw_image_with_rotation(dwg, 'Skins/Default/diode_45.svg')
        slf.add_text(dwg, slf.position[0] + offsetx, slf.position[1] + offsety,
                     slf.windows.get(0, (24, 0, "Left")), slf.attributes.get("InstName", ""))


class E(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/e.svg')
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            0, (36, 40, "Left")), slf.attributes.get("InstName", ""), angle=(int(slf.orientation[1:])) % 180)
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            3, (36, 76, "Left")), slf.attributes.get("Value", " "), angle=(int(slf.orientation[1:])) % 180)


class E2(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/e2.svg')
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            0, (36, 40, "Left")), slf.attributes.get("InstName", ""), angle=(int(slf.orientation[1:])) % 180)
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            3, (36, 76, "Left")), slf.attributes.get("Value", " "), angle=(int(slf.orientation[1:])) % 180)


class Flag(Component):
    def draw(slf, dwg):
        if (slf.attributes.get("Value", slf.component_type) == "0"):

            # Obtiene la direccion en la se debe dibujar el componente.
            direction = get_cable_directions(slf.position, wires)
            if direction == "up":
                slf.orientation = "R0"
            elif direction == "down":
                slf.orientation = "R180"
            elif direction == "left":
                slf.orientation = "R270"
            elif direction == "right":
                slf.orientation = "R90"

            slf.draw_image_with_rotation(dwg, 'Skins/Default/GND.svg')
        else:
            slf.draw_image_with_rotation(dwg, 'Skins/Default/flag.svg')
            place_text_according_to_cable(slf.position, slf.attributes.get(     # Obtiene la direccion en la se debe dibujar el texto (Vi--- ; ---Vo ) y luego imprime.
                "Value", slf.component_type), wires, dwg)


class G(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/g.svg')
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            0, (36, 40, "Left")), slf.attributes.get("InstName", ""), angle=(int(slf.orientation[1:])) % 180)
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            3, (36, 76, "Left")), slf.attributes.get("Value", " "), angle=(int(slf.orientation[1:])) % 180)


class G2(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/g2.svg')
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            0, (36, 40, "Left")), slf.attributes.get("InstName", ""), angle=(int(slf.orientation[1:])) % 180)
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            3, (36, 76, "Left")), slf.attributes.get("Value", " "), angle=(int(slf.orientation[1:])) % 180)


class GainBlock(Component):
    def draw(slf, dwg):      
        slf.draw_image_with_rotation(dwg, 'Skins/Default/Gain_Block.svg')

        offsetx = offset_text(slf, -10, 32.5, 10, -30, slf.flip)
        offsety = offset_text(slf, 0, 0, 5, 10, slf.flip)
       
        slf.add_text(dwg, slf.position[0] + offsetx, slf.position[1] + offsety, slf.windows.get(
            3, (-158, 48, "Left")), slf.attributes.get("Value", "K = 10"))


class Inductor(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/ind.svg')
        offsetx = offset_text(slf, 0, -112.5, 0, 112.5, slf.flip)
        offsetx2 = offset_text(slf, 0, -112.5, 0, 112.5, slf.flip)
        slf.flip *= -1 # el inductor tiene los textos al revés de R y C por default
       
        slf.add_text(dwg, slf.position[0] + offsetx, slf.position[1], slf.windows.get(
            0, (-2, 40, "Left")), slf.attributes.get("InstName", ""))
        # Si el valor es numérico se agrega la unidad#
        val = slf.attributes.get("Value", "L")
        # No verifica el último caracter porque puede ser pico micro mili, etc
        if all(char.isnumeric() or char == "." for char in val[:-1]):
            units = ["f", "p", "n", "µ", "u", "m",
                     "k", "F", "P", "N", "U", "M", "K"]
            # El último caracter es un número o alguna unidad
            if True in [val[-1] == units[i] for i in range(len(units))] or val[-1].isnumeric():
                val = val + "H"
        # Caso especial índice "MEG"
        if val[-3:].lower() == "meg":
            val = val + "H"

        slf.add_text(dwg, slf.position[0] + offsetx2, slf.position[1], slf.windows.get(
            3, (-2, 72, "Left")), val)


class LTap(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/L_Tap.svg')
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            3, (40, 58, "Left")), slf.attributes.get("Value", " "), angle=(int(slf.orientation[1:])) % 180)
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            123, (40, 134, "Left")), slf.attributes.get("Value2", "n=3"), angle=(int(slf.orientation[1:])) % 180)


class LM311(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/LM311.svg')
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            0, (-112, -16, "Left")), slf.attributes.get("InstName", ""), angle=(int(slf.orientation[1:])) % 180)
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            3, (-112, 7, "Left")), slf.attributes.get("Value", " "), angle=(int(slf.orientation[1:])) % 180)
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            69, (-89, 82, "Left")), "GND", "8px", angle=(int(slf.orientation[1:])) % 180)

class LM7805(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/7805.svg')
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            0, (56, 32, "Left")), slf.attributes.get("InstName", ""))

class MarcadorBloques(Component):
    def draw(slf, dwg):
        offsety = offset_text(slf,10, -13, 2, 10)
        slf.draw_image_with_rotation(dwg, 'Skins/Default/Marcador_Bloques.svg')
        slf.add_text(dwg, slf.position[0], slf.position[1] + offsety, slf.windows.get(
            0, (15, -32, "VTop")), slf.attributes.get("Value", "G"), color = "#005B96")


class NJFet(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/njf.svg')
        offsetx = offset_text(slf, -7, -6, 7, 6, slf.flip)
        offsety = offset_text(slf, 15, 0, -11, 2)
        slf.add_text(dwg, slf.position[0] + offsetx, slf.position[1] + offsety,
                     slf.windows.get(0, (56, 32, "Left")), slf.attributes.get("InstName", ""))


class NMOS(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/nmos.svg')
        offsetx = offset_text(slf, -6, 0, 6, -0, slf.flip)
        offsety = offset_text(slf, 15, 3, -7, 0)
        slf.add_text(dwg, slf.position[0] + offsetx, slf.position[1] + offsety,
                     slf.windows.get(0, (56, 32, "Left")), slf.attributes.get("InstName", ""))

class NMOS4(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/nmos4.svg')
        offsetx = offset_text(slf, -6, 0, 6, -0, slf.flip)
        offsety = offset_text(slf, 15, 3, -7, 0)
        slf.add_text(dwg, slf.position[0] + offsetx, slf.position[1] + offsety,
                     slf.windows.get(0, (56, 32, "Left")), slf.attributes.get("InstName", ""))

class NPN(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/NPN.svg')
        offsety = offset_text(slf, 0, 0, -24, 0)
        slf.add_text(dwg, slf.position[0], slf.position[1] + offsety, slf.windows.get(
            0, (56, 32, "Left")), slf.attributes.get("InstName", ""))

class node(Component):
    def draw(slf, dwg):
        x, y = slf.position
        offsetx = offset_text(slf, 16,-16,-16,16, slf.flip)
        offsety = offset_text(slf, 16,16,-16,-16)
        slf.position = (x + offsetx, y + offsety)
        slf.draw_image_with_rotation(dwg, 'Skins/Default/flag.svg')


class Not(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/74HCU04 Not.svg')
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            0, (16, 16, "Left")), slf.attributes.get("InstName", ""), angle=(int(slf.orientation[1:])) % 180)
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            3, (7, 87, "Left")), slf.attributes.get("Value", "74HCU04"), "11px",  (int(slf.orientation[1:])) % 180)
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            69, (7, 28, "Left")), slf.attributes.get("Value", "Vdd"), "10px",  (int(slf.orientation[1:])) % 180)
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            125, (7, 104, "Left")), slf.attributes.get("Value2", "GND"), "10px", (int(slf.orientation[1:])) % 180)


class OpAmp(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/OA_Ideal.svg')
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            0, (-113, 80, "Left")), slf.attributes.get("InstName", ""), angle=(int(slf.orientation[1:])) % 180)
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            3, (-176, 32, "Left")), slf.attributes.get("Value", " "), "9px",  (int(slf.orientation[1:])) % 180)
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            123, (-176, 48, "Left")), slf.attributes.get("Value2", " "), "9px", (int(slf.orientation[1:])) % 180)

class OA_Box(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/OA_Box.svg')
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            0, (-113, 80, "Left")), slf.attributes.get("InstName", ""), angle=(int(slf.orientation[1:])) % 180)
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            3, (-176, 32, "Left")), slf.attributes.get("Value", " "), "9px",  (int(slf.orientation[1:])) % 180)
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            123, (-176, 48, "Left")), slf.attributes.get("Value2", " "), "9px", (int(slf.orientation[1:])) % 180)

class OA_Yiu(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/OA_Yiu.svg')
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            0, (-113, 80, "Left")), slf.attributes.get("InstName", ""), angle=(int(slf.orientation[1:])) % 180)
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            3, (-176, 32, "Left")), slf.attributes.get("Value", " "), "9px",  (int(slf.orientation[1:])) % 180)
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            123, (-176, 48, "Left")), slf.attributes.get("Value2", " "), "9px", (int(slf.orientation[1:])) % 180)

class OA_Signal(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/OA_Signal.svg')
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            0, (70, 120, "Left")), slf.attributes.get("InstName", ""), angle=(int(slf.orientation[1:])) % 180)
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            3, (180, 60, "Left")), slf.attributes.get("Value", " "), "20px",  (int(slf.orientation[1:])) % 180)
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            123, (180, 90, "Left")), slf.attributes.get("Value2", " "), "20px", (int(slf.orientation[1:])) % 180)
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            123, (180, 120, "Left")), slf.attributes.get("SpiceLine", " "), "20px", (int(slf.orientation[1:])) % 180)

class OA_Signal2(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/OA_Signal2.svg')
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            0, (70, 120, "Left")), slf.attributes.get("InstName", ""), angle=(int(slf.orientation[1:])) % 180)
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            3, (180, 60, "Left")), slf.attributes.get("Value", " "), "20px",  (int(slf.orientation[1:])) % 180)
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            123, (180, 90, "Left")), slf.attributes.get("Value2", " "), "20px", (int(slf.orientation[1:])) % 180)
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            123, (180, 120, "Left")), slf.attributes.get("SpiceLine", " "), "20px", (int(slf.orientation[1:])) % 180)
    
class PJFet(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/pjf.svg')
        offsetx = offset_text(slf, -7, -6, 7, 6, slf.flip)
        offsety = offset_text(slf, 15, 0, -11, 2)
        slf.add_text(dwg, slf.position[0] + offsetx, slf.position[1] + offsety,
                     slf.windows.get(0, (56, 32, "Left")), slf.attributes.get("InstName", ""))


class PMOS(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/pmos.svg')
        offsetx = offset_text(slf, -7, -3, 7, 6, slf.flip)
        offsety = offset_text(slf, 15, 2, -11, 2)
        slf.add_text(dwg, slf.position[0] + offsetx, slf.position[1] + offsety,
                     slf.windows.get(0, (56, 32, "Left")), slf.attributes.get("InstName", ""))

class PMOS4(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/pmos4.svg')
        offsetx = offset_text(slf, -7, -3, 7, 6, slf.flip)
        offsety = offset_text(slf, 15, 2, -11, 2)
        slf.add_text(dwg, slf.position[0] + offsetx, slf.position[1] + offsety,
                     slf.windows.get(0, (56, 32, "Left")), slf.attributes.get("InstName", ""))
        

class PNP(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/PNP.svg')
        offsety = offset_text(slf, 0, 0, -24, 0)
        slf.add_text(dwg, slf.position[0], slf.position[1] + offsety, slf.windows.get(
            0, (56, 32, "Left")), slf.attributes.get("InstName", ""))


class Pot(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/pot.svg')
        offsetx = offset_text(slf, 0, -33, 0, 20, slf.flip)
        offsetx2 = offset_text(slf, 0, 40, 0, 2, slf.flip)
        offsety = offset_text(slf, 10, -45, 0, 2)
        offsety2 = offset_text(slf, 5, 5, 0, 51)

        offsetxk = offset_text(slf, 0, 5, 0, -5)
        offsetyk = offset_text(slf, 0, 7, 5, 0)

        slf.add_text(dwg, slf.position[0] + offsetx, slf.position[1]+offsety, slf.windows.get(
            0, (36, 10, "Left")), "P"+slf.attributes.get("InstName", "")[1:])
        slf.add_text(dwg, slf.position[0] + offsetx2, slf.position[1]+offsety2, slf.windows.get(
            3, (36, 40, "Left")), slf.attributes.get("Value", "R=10k")[2:] + "Ω")
        slf.add_text(dwg, slf.position[0] + offsetxk, slf.position[1] +
                     offsetyk, (33, 77, "Left"), "k")     # Se añade la letra "k"


class Resistor(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/res.svg')
        offsety = offset_text(slf, 0, 0, 10)
        slf.add_text(dwg, slf.position[0], slf.position[1] + offsety, slf.windows.get(
            0, (36, 40, "Left")), slf.attributes.get("InstName", ""))
        # Si el valor es numérico se agrega la unidad#
        val = slf.attributes.get("Value", "R")
        # No verifica el último caracter porque puede ser pico micro mili, etc
        if all(char.isnumeric() or char == "." for char in val[:-1]):
            units = ["f", "p", "n", "µ", "u", "m",
                     "k", "F", "P", "N", "U", "M", "K"]
            # El último caracter es un número o alguna unidad
            if True in [val[-1] == units[i] for i in range(len(units))] or val[-1].isnumeric():
                val = val + "Ω"
        # Caso especial índice "MEG"
        if val[-3:].lower() == "meg":
            val = val[:-3] + "MΩ"
        slf.add_text(dwg, slf.position[0], slf.position[1] + offsety, slf.windows.get(
            3, (36, 76, "Left")), val)

class Res45(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/res_45.svg')
        offsetx = offset_text(slf, 15, 0, -17, 0, slf.flip)
        offsety = offset_text(slf, 0, -30, 10, -25)
        slf.add_text(dwg, slf.position[0] + offsetx, slf.position[1] + offsety,
                     slf.windows.get(0, (36, 40, "Left")), slf.attributes.get("InstName", ""))
        slf.add_text(dwg, slf.position[0] + offsetx, slf.position[1] + offsety,
                     slf.windows.get(3, (36, 76, "Left")), slf.attributes.get("Value", " "))


class Res60(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/res_60.svg')
        offsetx = offset_text(slf, 15, 0, -17, 0, slf.flip)
        offsety = offset_text(slf, 0, -30, 10, -25)
        slf.add_text(dwg, slf.position[0] + offsetx, slf.position[1] + offsety,
                     slf.windows.get(0, (36, 40, "Left")), slf.attributes.get("InstName", ""))
        slf.add_text(dwg, slf.position[0] + offsetx, slf.position[1] + offsety,
                     slf.windows.get(3, (36, 76, "Left")), slf.attributes.get("Value", " "))


class ResPipe(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/res_pipe.svg')
        offsety = offset_text(slf, 7, 7)
        slf.add_text(dwg, slf.position[0], slf.position[1] + offsety, slf.windows.get(
            0, (36, 40, "Left")), slf.attributes.get("InstName", ""))
        slf.add_text(dwg, slf.position[0], slf.position[1] + offsety, slf.windows.get(
            3, (36, 76, "Left")), slf.attributes.get("Value", "R"))


class Schottky(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/schottky.svg')
        offsetx = offset_text(slf, -10, 0, -17, slf.flip)
        offsety = offset_text(slf, 0, 0, 37)
        slf.add_text(dwg, slf.position[0] + offsetx, slf.position[1] + offsety,
                     slf.windows.get(0, (56, 32, "Left")), slf.attributes.get("InstName", ""))
        slf.add_text(dwg, slf.position[0] + offsetx, slf.position[1] + offsety,
                     slf.windows.get(3, (56, 68, "Left")), slf.attributes.get("Value", " "))


class Signal(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/signal.svg')
        offsetx = offset_text(slf, 0, 0, -8, 0, slf.flip)
        offsety = offset_text(slf, 0, 0, 20, 0)
        slf.add_text(dwg, slf.position[0] + offsetx, slf.position[1] + offsety,
                     slf.windows.get(0, (36, 40, "Left")), slf.attributes.get("InstName", ""))
        slf.add_text(dwg, slf.position[0] + offsetx, slf.position[1] + offsety,
                     slf.windows.get(3, (36, 76, "Left")), slf.attributes.get("Value", " "))


class Supply(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/supply.svg')
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            0, (36, 40, "Left")), slf.attributes.get("InstName", ""))
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            3, (36, 76, "Left")), slf.attributes.get("Value", " "))


class Switch(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/switch.svg')


class SwitchSch(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/switch_sch.svg')


class TL082(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/TL082.svg')
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            0, (-113, 80, "Left")), slf.attributes.get("InstName", ""), angle=(int(slf.orientation[1:])) % 180)

class Vcc(Component):
    def draw(slf, dwg):
        x, y = slf.position
        offsetx = offset_text(slf, 20,-16,-20,16, slf.flip)
        offsety = offset_text(slf, 16,20,-15,-15)
        slf.position = (x + offsetx, y + offsety)
        slf.draw_image_with_rotation(dwg, 'Skins/Default/FLAG.svg')
        value = slf.attributes.get("Value", "V=15")
        parts = value.split("=")
        formatted_value = f"{parts[1]}{parts[0]}"  # Reorganizar como "15V"

        offsetx = offset_text(slf, 0,16,-3,-20, slf.flip)
        offsety = offset_text(slf, 0,10,7,-5)
        slf.add_text(dwg, slf.position[0] + offsetx, slf.position[1] + offsety, slf.windows.get(
            3, (5, 0, "Left")), formatted_value)

class Voltage(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/voltage.svg')
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            0, (36, 40, "Left")), slf.attributes.get("InstName", ""))
        # Si el valor es numérico se agrega la unidad#
        val = slf.attributes.get("Value", " ")
        if all(char.isnumeric() or char == "." for char in val):
            val = val + "V"
        slf.add_text(dwg, slf.position[0], slf.position[1], slf.windows.get(
            3, (36, 76, "Left")), val)


class Xtal(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/xtal_.svg')
        offsety = offset_text(slf, 0, 0, 23, 0)
        slf.add_text(dwg, slf.position[0], slf.position[1] - 8 + offsety, slf.windows.get(
            0, (24, 8, "Left")), slf.attributes.get("InstName", ""))
        slf.add_text(dwg, slf.position[0], slf.position[1] + 5 + offsety, slf.windows.get(
            3, (24, 56, "Left")), slf.attributes.get("Value", " "))


class Zener(Component):
    def draw(slf, dwg):
        slf.draw_image_with_rotation(dwg, 'Skins/Default/zener.svg')
        offsetx = offset_text(slf, -10, 0, -18, 0, slf.flip)
        offsety = offset_text(slf, 0, 0, 37)
        slf.add_text(dwg, slf.position[0] + offsetx, slf.position[1] + offsety,
                     slf.windows.get(0, (56, 32, "Left")), slf.attributes.get("InstName", ""))
        slf.add_text(dwg, slf.position[0] + offsetx, slf.position[1] + offsety,
                     slf.windows.get(3, (56, 68, "Left")), slf.attributes.get("Value", " "))


def offset_text(slf, off0=0, off90=0, off180=0, off270=0, flip=1):
    if (slf.orientation == "R0"):
        return ((flip) * off0)
    elif (slf.orientation == "R90"):
        return ((flip) * off90)
    elif (slf.orientation == "R180"):
        return ((flip) * off180)
    elif (slf.orientation == "R270"):
        return ((flip) * off270)
    else:
        return 0


def parse_asc_file(texto):
    # Inicializa las listas para almacenar los wires (conexiones) y componentes.
    wires = []
    lines = []
    components = []
    comments = []
    current_component = None
    windowsize = None
    # Tamaño inicial del rectángulo más grande encontrado.
    max_rectangle_size = (0, 0)
    global minx
    global miny
    global hay_rectangulo
    # Establece valores iniciales altos para las coordenadas mínimas (minx, miny).
    minx = 10000
    miny = 10000
    found_rectangle = False

    lineas = texto.splitlines()
    if True:
        for line in lineas:
            parts = line.split()
            if not parts:
                continue

            if parts[0] == 'RECTANGLE':
                # Identifica líneas que describen rectángulos y calcula sus dimensiones.
                found_rectangle = True
                x1, y1 = map(int, parts[2:4])
                x2, y2 = map(int, parts[4:6])
                dx = abs(x1 - x2)
                dy = abs(y1 - y2)
                # Actualiza las coordenadas mínimas.
                minx = min([x1, x2, minx])
                miny = min([y1, y2, miny])
                # Si el área del rectángulo es mayor que el máximo anterior, lo actualiza.
                if (dx * dy) > (max_rectangle_size[0] * max_rectangle_size[1]):
                    max_rectangle_size = (dx, dy)

        hay_rectangulo = found_rectangle
        # Si no se encuentra ningún rectángulo, asigna valores predeterminados.
        if not found_rectangle:
            dx = 10000
            dy = 10000
            minx = -5000
            miny = -5000
            if (dx * dy) > (max_rectangle_size[0] * max_rectangle_size[1]):
                max_rectangle_size = (dx, dy)

        # Reinicia el puntero del archivo al principio para procesar las demás líneas.
        for line in lineas:
            parts = line.split()
            if not parts:
                continue

            if parts[0] == "WIRE":
                # Almacena las coordenadas de las conexiones (wires).
                x1, y1, x2, y2 = map(int, parts[1:])
                wires.append(((x1, y1), (x2, y2)))

            if parts[0] == "LINE":
                # Si falta el último parámetro, asignar 1 por defecto
                if len(parts) == 6:
                    line_type = 0
                else:
                    line_type = int(parts[5])

                x1, y1, x2, y2 = map(int, parts[2:6])
                lines.append(
                    {"coords": ((x1, y1), (x2, y2)), "type": line_type})

            elif parts[0] == "SYMBOL":
                # Si hay un componente actual, lo agrega a la lista de componentes.
                if current_component:
                    components.append(current_component)

                component_type = parts[1]
                if '\\' in component_type:
                    component_type_parts = component_type.split('\\')
                    # Caso especial: si el nombre del componente termina en "\\".
                    if component_type_parts[-1] == '':
                        component_name = parts[2]
                        coords_and_orientation = parts[3:]
                    else:
                        component_name = component_type_parts[-1].split()[-1]
                        coords_and_orientation = parts[2:]
                else:
                    component_name = component_type
                    coords_and_orientation = parts[2:]

                # Extrae las coordenadas y la orientación del componente.
                x, y = map(int, coords_and_orientation[:2])
                orientation = coords_and_orientation[2] if len(
                    coords_and_orientation) > 2 else "R0"

                # Determina si el componente está espejado.
                if orientation.startswith("M"):
                    orientation = 'R' + orientation[1:]
                    flip = -1
                else:
                    flip = 1

                # Crea un diccionario para el componente actual con sus propiedades.
                current_component = {"type": component_name, "position": (x, y),
                                     "orientation": orientation, "flip": flip,
                                     "attributes": {}, "windows": {}}

            elif parts[0] == "SYMATTR" and current_component:
                # Almacena los atributos del componente actual
                attribute_name = parts[1]
                attribute_value = " ".join(parts[2:])
                current_component["attributes"][attribute_name] = attribute_value

            elif parts[0] == "WINDOW" and current_component:
                # Procesa la ventana asociada al componente.
                if "Invisible" in parts:
                    x = 25040.2
                    y = -25040.2
                else:
                    x, y = map(int, parts[2:4])

                window_index = int(parts[1])
                alignment = parts[4]
                current_component["windows"][window_index] = (x, y, alignment)

            elif parts[0] == "FLAG":
                # Procesa los flags (banderas) como un tipo especial de componente.
                x, y = map(int, parts[1:3])
                component_type = "flag"
                orientation = "R0"
                flip = 1
                flag = {"type": component_type, "position": (x, y),
                        "orientation": orientation, "flip": flip,
                        "attributes": {}, "windows": {}}
                flag["attributes"]["Value"] = parts[3]
                components.append(flag)
            
            elif parts[0] == "TEXT":
                # Procesa las líneas de texto. Identifica comentarios (;) y directivas (!).
                x, y = map(int, parts[1:3])
                orientation = parts[3]
                if len(parts) > 5 and parts[5].startswith(";"):
                    comment = " ".join(parts[5:])[1:]
                    comments.append({"position": (x, y), "orientation": orientation, "text": comment})

        # Añade el último componente encontrado a la lista.
        if current_component:
            components.append(current_component)

    # Actualiza el tamaño de la ventana si se encontraron rectángulos.
    if max_rectangle_size != (0, 0):
        windowsize = max_rectangle_size

    return wires, lines, components, comments, windowsize


def get_cable_directions(pin_position, cables):
    # Recibe la posición de un pin y una lista de cables (definidos por posiciones de inicio y fin).
    # Devuelve una lista de direcciones (right, left, up, down) en las que hay cables conectados al pin.

    directions = []
    for (start, end) in cables:
        if pin_position == start:
            # Si la posición del pin coincide con el inicio del cable, calcula la dirección hacia el final del cable.
            dx = end[0] - start[0]
            dy = end[1] - start[1]
        elif pin_position == end:
            # Si la posición del pin coincide con el final del cable, calcula la dirección hacia el inicio del cable.
            dx = start[0] - end[0]
            dy = start[1] - end[1]
        else:
            continue

        # Determina las direcciones en función de los valores dx y dy y añade las direcciones correspondientes a la lista.
        if dx > 0 and "right" not in directions:
            directions.append("right")
        elif dx < 0 and "left" not in directions:
            directions.append("left")
        if dy > 0 and "down" not in directions:
            directions.append("down")
        elif dy < 0 and "up" not in directions:
            directions.append("up")

    # Si se encontraron direcciones, las devuelve como una cadena separada por comas.
    # Si no se encontraron direcciones, devuelve None.
    if directions:
        return ", ".join(directions)
    else:
        return "up"


def place_text_according_to_cable(pin_position, text, cables, dwg, offset=20):
    # Coloca un texto en un diagrama SVG en función de la dirección de los cables conectados al pin.

    directions = get_cable_directions(pin_position, cables)

    if "up" in directions:
        # Si hay un cable hacia arriba, coloca el texto debajo del pin.
        if "right" in directions:
            text_position = (pin_position[0] -
                             int(offset/2), pin_position[1] + 5)
            dwg.add(dwg.text(text, insert=text_position,
                    class_='flag', font_family=font, font_size=fontSize, text_anchor="end"))
        else:
            text_position = (pin_position[0], pin_position[1] + offset + 2)
            dwg.add(dwg.text(text, insert=text_position, font_family=font,
                    font_size=fontSize, text_anchor="middle"))

    elif "down" in directions:
        # Si hay un cable hacia abajo, coloca el texto arriba del pin.
        text_position = (pin_position[0], pin_position[1] - offset + 10)
        dwg.add(dwg.text(text, insert=text_position, font_family=font,
                font_size=fontSize, text_anchor="middle"))

    elif "left" in directions:
        # Si hay un cable hacia la izquierda, coloca el texto a la derecha del pin.
        if "right" in directions:
            text_position = (pin_position[0], pin_position[1] - offset + 10)
            dwg.add(dwg.text(text, insert=text_position, font_family=font,
                    font_size=fontSize, text_anchor="middle"))
        else:
            text_position = (pin_position[0] +
                             int(offset/2), pin_position[1] + 5)
            dwg.add(dwg.text(text, insert=text_position,
                    class_='flag', font_family=font, font_size=fontSize, text_anchor="start"))

    elif "right" in directions:
        # Si hay un cable hacia la derecha, coloca el texto a la izquierda del pin.
        text_position = (pin_position[0] - int(offset/2), pin_position[1] + 5)
        dwg.add(dwg.text(text, insert=text_position, font_family=font,
                font_size=fontSize, text_anchor="end"))

    else:
        # Si no se encuentra ninguna dirección de cable, no se hace nada con el texto.
        text_position = pin_position


def add_comment(dwg, pos, text, angle):
    # Diccionario que mapea los valores de 'angle' a los grados correspondientes
    angle_map = {
        "Left": 0,
        "VLeft": 90,
        "Right": 0,
        "VRight": 90
    }
    
    # Obtén el valor de ángulo a partir del diccionario
    ang = angle_map.get(angle, 0)  # Si no encuentra el valor, por defecto usa 0

    # Crea un elemento de texto, ajustando la alineación según la orientación y el espejado:
    text_element = dwg.text(
        text, 
        insert=(pos[0], pos[1]), 
        font_family=font, 
        font_size=fontSize, 
        text_anchor="start" if angle in ["VLeft", "Left"] else "end",
        fill="#005B96", class_="comentario"
    )

    # Aplica una rotación al texto en función del ángulo especificado:
    text_element.rotate(-ang, center=(pos[0], pos[1]))
    dwg.add(text_element)

def create_circuit_svg(filename, wires, lines, components, comments):
    global minx
    global miny
    dwg = svgwrite.Drawing(filename, size=windowsize, profile='tiny')
    nodes = {}

    # Dibujar cables y detectar nodos
    for (start, end) in wires:
        dwg.add(dwg.line(start=start, end=end, stroke=svgwrite.rgb(
            0, 0, 0, '%'), stroke_linecap="round", stroke_linejoin="round", stroke_miterlimit="10", stroke_width=1.5))
        for point in [start, end]:
            if point in nodes:
                nodes[point] += 1
            else:
                nodes[point] = 1

    # Dibujar nodos si se intersectan 3 o más cables
    for point, count in nodes.items():
        if count >= 3:
            dwg.add(dwg.circle(center=point, r=4, fill='black', class_='nodo'))

    #Escribir comentarios
    for comment in comments:
        add_comment(dwg, comment['position'], comment['text'], comment['orientation'])



    # Dibujar líneas
    for line in lines:
        start, end = line["coords"]
        line_type = line["type"]

        if line_type == 0:
            stroke_dasharray = None  # Línea continua (sin punteado)
            stroke_width = 1.5
        elif line_type == 1:
            stroke_dasharray = "4,3"  # Línea intersectada
            stroke_width = 1
        else:
            stroke_dasharray = "1,4"  # Línea punteada
            stroke_width = 0.5

        if stroke_dasharray:
            line_element = dwg.line(start=start, end=end, stroke=svgwrite.rgb(
                0, 0, 0, '%'), stroke_linecap="round", stroke_linejoin="round", stroke_miterlimit="10",
                stroke_width=stroke_width, stroke_dasharray=stroke_dasharray)
        else:
            line_element = dwg.line(start=start, end=end, stroke=svgwrite.rgb(
                0, 0, 0, '%'), stroke_linecap="round", stroke_linejoin="round", stroke_miterlimit="10",
                stroke_width=stroke_width)

        dwg.add(line_element)

    # Dibujar componentes
    component_objects = {
        "7805": LM7805,
        "Amp_Current": Amp_Current,
        "Amp_Transimpedance": Amp_Transimpedance,
        "ampmeter": Ampmeter,
        "arrow": Arrow,
        "arrow_curve": Arrow_curve,
        "arrow_Z": Arrow_Z,
        "arrow_Z2": Arrow_Z2,
        "bv": Bv,
        "bi": Bi,
        "bypass": Bypass,
        "cap": Capacitor,
        "current": Current,
        "cell": Cell,
        "dif": Dif,
        "diode": Diode,
        "diode_45": Diode45,
        "e": E,
        "e2": E2,
        "flag": Flag,
        "g": G,
        "g2": G2,
        "Gain_Block": GainBlock,
        "ind": Inductor,
        "L_Tap": LTap,
        "LM311": LM311,
        "LM741": TL082,
        "Marcador_Bloques" : MarcadorBloques,
        "njf": NJFet,
        "nmos": NMOS,
        "nmos4": NMOS4,
        "npn": NPN,
        "Not": Not,
        "node": node,
        "OA_Ideal": OpAmp,
        "OA_Signal": OA_Signal,
        "OA_Signal2": OA_Signal2,
        "OA_Box": OA_Box,
        "OA_Yiu": OA_Yiu,
        "pjf": PJFet,
        "pmos": PMOS,
        "pmos4": PMOS4,
        "pnp": PNP,
        "pot": Pot,
        "res": Resistor,
        "res_45": Res45,
        "res_60": Res60,
        "res_pipe": ResPipe,
        "schottky": Schottky,
        "signal": Signal,
        "supply": Supply,
        "switch": Switch,
        "switch_sch": SwitchSch,
        "TL082": TL082,
        "Vcc": Vcc,
        "voltage": Voltage,
        "xtal": Xtal,
        "zener": Zener
    }

    for component in components:
        component_type = component["type"]
        if component_type in component_objects:
            component_obj = component_objects[component_type](
                component_type,
                component["position"],
                component["orientation"],
                component["flip"],
                component["attributes"],
                component["windows"]
            )
            component_obj.draw(dwg)
        else:
            _dibujar_desconocido(dwg, component)

    dwg.viewbox(minx, miny, windowsize[0], windowsize[1])
    return dwg.tostring()


# ---------------------------------------------------------------------------
# Agregado para kumOS

_CSS_A_ATRIBUTO = ('stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray',
                   'fill', 'font-size', 'font-style', 'font-weight', 'opacity')
_skins = {}


def _mult(m1, m2):
    """Producto de dos matrices de transformación SVG (a, b, c, d, e, f): primero se aplica m2."""
    a1, b1, c1, d1, e1, f1 = m1
    a2, b2, c2, d2, e2, f2 = m2
    return (a1 * a2 + c1 * b2, b1 * a2 + d1 * b2, a1 * c2 + c1 * d2, b1 * c2 + d1 * d2, a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1)


def _rotar(grados, cx, cy):
    """rotate(grados, cx, cy) como matriz (los giros de 90 en 90 salen exactos)."""
    c, sn = {0: (1, 0), 90: (0, 1), 180: (-1, 0), 270: (0, -1)}.get(grados % 360, (None, None))
    if c is None:
        import math
        c, sn = math.cos(math.radians(grados)), math.sin(math.radians(grados))
    return _mult((1, 0, 0, 1, cx, cy), _mult((c, sn, -sn, c, 0, 0), (1, 0, 0, 1, -cx, -cy)))


def _rol(slf, texto):
    """Qué es un texto: el nombre del componente (R1, C2...) o su valor (10k, 100n...)."""
    return 'nombre' if texto == slf.attributes.get("InstName", None) else 'valor'


def _sin_px(v):
    return re.sub(r'(?<=\d)px\b', '', v)


def _reglas_css(raiz):
    """Lee los <style> de un símbolo: {clase: {propiedad: valor}} (solo selectores .clase, que es lo que traen)."""
    css = ''.join((e.text or '') for e in raiz.iter() if e.tag.split('}')[-1] == 'style')
    reglas = {}
    for selectores, cuerpo in re.findall(r'([^{}]+)\{([^}]*)\}', css):
        props = {}
        for p in cuerpo.split(';'):
            if ':' in p:
                k, v = p.split(':', 1)
                props[k.strip()] = v.strip()
        for sel in selectores.split(','):
            sel = sel.strip()
            if sel.startswith('.'):
                reglas.setdefault(sel[1:], {}).update(props)
    return reglas


def _a_texto(e, reglas):
    tag = e.tag.split('}')[-1]
    if tag in ('defs', 'style', 'title', 'desc', 'metadata'):
        return ''
    attrs = {}
    for k, v in e.attrib.items():
        k = k.split('}')[-1]
        if k in ('class', 'id', 'data-name', 'version', 'style'):
            continue
        attrs[k] = v
    for cls in e.get('class', '').split():
        for k, v in reglas.get(cls, {}).items():
            if k in _CSS_A_ATRIBUTO:
                attrs[k] = _sin_px(v)
            elif k == 'font-family':
                attrs[k] = f"'{font}'"  # el programa original reemplaza toda fuente por LM Roman 10
    if tag in ('text', 'tspan') and 'font-family' not in attrs:
        attrs['font-family'] = f"'{font}'"
    if tag == 'text':
        attrs.setdefault('font-family', f"'{font}'")
    interior = ''.join(_a_texto(h, reglas) for h in e)
    texto = e.text if (e.text and e.text.strip()) else ''
    if tag in ('text', 'tspan') and texto:
        from xml.sax.saxutils import escape
        interior = escape(texto) + interior
    a = ''.join(f' {k}="{v}"' for k, v in attrs.items())
    return f'<{tag}{a}>{interior}</{tag}>' if interior else f'<{tag}{a}/>'


def _skin_incrustado(ruta):
    """Contenido de un símbolo, con el estilo de sus clases aplicado como atributos (así no se pisa con los de otros)."""
    if ruta in _skins:
        return _skins[ruta]
    try:
        with open(os.path.join(CARPETA_BASE, ruta), 'rb') as f:
            raiz = ET.fromstring(f.read())
        reglas = _reglas_css(raiz)
        _skins[ruta] = ''.join(_a_texto(h, reglas) for h in raiz)
    except (OSError, ET.ParseError):
        _skins[ruta] = None
    return _skins[ruta]


def _dibujar_desconocido(dwg, comp):
    """Símbolo que el programa no conoce: recuadro punteado con su nombre (en el original no se dibujaba nada)."""
    tipo = comp["type"]
    if tipo not in desconocidos:
        desconocidos.append(tipo)
    x, y = comp["position"]
    dwg.add(svgwrite.Crudo(
        f'<g class="faltante"><rect x="{x - 24}" y="{y - 24}" width="48" height="48" fill="none" stroke="#c0392b" '
        f'stroke-width="1" stroke-dasharray="4,3"/></g>'))
    nombre = comp["attributes"].get("InstName", "")
    dwg.add(dwg.text(tipo, insert=(x, y + 40), class_='faltante', font_family=font, font_size="12px", text_anchor="middle", fill="#c0392b"))
    if nombre:
        dwg.add(dwg.text(nombre, insert=(x, y - 32), class_='faltante', font_family=font, font_size=fontSize, text_anchor="middle", fill="#c0392b"))


def convertir(texto):
    """Convierte el texto de un .asc en un dibujo SVG. Devuelve un diccionario con el SVG y datos del dibujo."""
    global windowsize, wires, desconocidos, skins_faltantes
    desconocidos = []
    skins_faltantes = []
    wires_, lines, components, comments, ventana = parse_asc_file(texto)
    wires = wires_
    windowsize = ventana
    svg = create_circuit_svg('', wires_, lines, components, comments)
    return {
        'svg': svg,
        'rectangulo': bool(hay_rectangulo),
        'x': minx,
        'y': miny,
        'ancho': windowsize[0],
        'alto': windowsize[1],
        'componentes': len([c for c in components if c['type'] != 'flag']),
        'cables': len(wires_),
        'desconocidos': list(desconocidos),
        'skins_faltantes': list(skins_faltantes),
    }
