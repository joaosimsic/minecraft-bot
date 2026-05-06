import { join } from 'node:path';
import { config } from '../config';

export const JAR_VER = config.env.VIAPROXY_VERSION;
export const JAR_NAME = `ViaProxy-${config.env.VIAPROXY_VERSION}.jar`;
export const PROXY_DIR = join(process.cwd(), '.viaproxy');
export const JAR_PATH = join(PROXY_DIR, JAR_NAME);
