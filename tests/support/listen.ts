import {randomInt} from 'node:crypto';
import type {FastifyInstance} from 'fastify';

/** Windows may allocate a port rejected by fetch (for example 10080).
 * Use the dynamic/private range and retry bind conflicts, never an existing server. */
export async function listenTestApp(app:FastifyInstance) {
  for(let attempt=0;attempt<30;attempt++) {
    try { return await app.listen({host:'127.0.0.1',port:randomInt(49152,65536)}); }
    catch(error) { if((error as NodeJS.ErrnoException).code!=='EADDRINUSE')throw error; }
  }
  throw Error('No free private test port after 30 attempts');
}
