import {
  BadRequestException, ConflictException, Injectable,
  NotFoundException, ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type Libro = {
  id: number; titulo: string; autor: string;
  anio: number | null; paginas: number | null;      // Google Books no siempre los trae
  categoria: string; isbn13: string | null;
  sinopsis: string; ejemplares: number;
};
export type Prestamo = {
  id: number; libroId: number; usuarioSub: string;
  desde: string; hasta: string; devuelto: boolean;
};

@Injectable()
export class PanelService {
  private readonly librosUrl: string;
  private readonly prestamosUrl: string;

  constructor(config: ConfigService) {
    this.librosUrl    = config.getOrThrow<string>('LIBROS_URL');
    this.prestamosUrl = config.getOrThrow<string>('PRESTAMOS_URL');
  }

  // fetch NO lanza con un 404 ni con un 500: hay que mirar .ok a mano. Es lo de X4.
  private async pedir<T>(url: string, nombre: string): Promise<T> {
    let respuesta: Response;
    try {
      respuesta = await fetch(url);
    } catch {
      throw new ServiceUnavailableException(`el microservicio de ${nombre} no responde`);
    }
    if (!respuesta.ok) {
      throw new ServiceUnavailableException(`el microservicio de ${nombre} devolvio ${respuesta.status}`);
    }
    return (await respuesta.json()) as T;
  }

  // Las dos llamadas salen juntas. Acá esta el argumento entero del BFF.
  private async traerTodo(): Promise<[Libro[], Prestamo[]]> {
    return Promise.all([
      this.pedir<Libro[]>(this.librosUrl, 'libros'),
      this.pedir<Prestamo[]>(this.prestamosUrl, 'prestamos'),
    ]);
  }

  // El cruce que hoy hace el navegador, hecho acá.
  private unir(prestamos: Prestamo[], libros: Libro[]) {
    const porId = new Map(libros.map((l) => [l.id, l]));
    return prestamos.map(({ libroId, ...resto }) => ({
      ...resto,
      libro: porId.get(libroId) ?? { id: libroId, titulo: 'libro no encontrado' },
    }));
  }

  async mios(sub: string) {
    const [libros, prestamos] = await this.traerTodo();
    const mios = prestamos.filter((p) => p.usuarioSub === sub);
    return { total: mios.length, prestamos: this.unir(mios, libros) };
  }

  async todos() {
    const [libros, prestamos] = await this.traerTodo();
    return { total: prestamos.length, prestamos: this.unir(prestamos, libros) };
  }

  // Solo para medir en el 4.3. En un proyecto de verdad esto no existiria.
  async miosEnSerie(sub: string) {
    const libros    = await this.pedir<Libro[]>(this.librosUrl, 'libros');
    const prestamos = await this.pedir<Prestamo[]>(this.prestamosUrl, 'prestamos');
    const mios = prestamos.filter((p) => p.usuarioSub === sub);
    return { total: mios.length, prestamos: this.unir(mios, libros) };
  }

  private async enviar<T>(metodo: string, url: string, token: string, cuerpo?: unknown): Promise<T> {
    let respuesta: Response;
    try {
      respuesta = await fetch(url, {
        method: metodo,
        headers: {
          ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
          Authorization: token,          // el mismo Bearer que llego al BFF
        },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      });
    } catch {
      throw new ServiceUnavailableException('el microservicio de prestamos no responde');
    }
    if (!respuesta.ok) {
      throw new ServiceUnavailableException(`el microservicio de prestamos devolvio ${respuesta.status}`);
    }
    return (await respuesta.json()) as T;
  }

  private dia(offset: number): string {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toISOString().split('T')[0];
  }

  async prestar(sub: string, token: string, libroId: unknown): Promise<Prestamo> {
    // ... las tres validaciones de L4 no cambian ...
    return this.enviar<Prestamo>('POST', this.prestamosUrl, token, {
      libroId,
      usuarioSub: sub,
      desde: this.dia(0),
      hasta: this.dia(14),
      devuelto: false,
    });
  }

  async devolver(sub: string, token: string, id: number): Promise<Prestamo> {
    // ... la busqueda y las dos comprobaciones de L4 no cambian ...
    return this.enviar<Prestamo>('DELETE', `${this.prestamosUrl}/${id}`, token);
  }
}
