import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  health() {
    return { status: 'ok', message: 'Holi Backend API is running' };
  }
}
