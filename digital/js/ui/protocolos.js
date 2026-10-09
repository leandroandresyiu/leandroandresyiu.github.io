// Los protocolos que ofrece Digital, en el orden de las pestañas.
import { CAN } from './can.js';
import { I2C } from './i2c.js';
import { SPI } from './spi.js';
import { UART } from './uart.js';

export const PROTOCOLOS = [UART, SPI, I2C, CAN];
