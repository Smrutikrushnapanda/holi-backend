import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Res,
  HttpCode,
} from '@nestjs/common';
import type { Response } from 'express';
import { TicketsService } from './tickets.service';

@Controller('tickets')
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  // Generate tickets (admin)
  @Post('generate')
  @HttpCode(200)
  async generate(@Body() body: { count?: number }) {
    const count = body.count || 200;
    const result = await this.ticketsService.generateTickets(count);
    return { message: `Tickets generation complete`, ...result };
  }

  // Scan a ticket (volunteer)
  @Post('scan')
  @HttpCode(200)
  async scan(@Body() body: { qrData: string; scannedBy?: string }) {
    return this.ticketsService.scanTicket(body.qrData, body.scannedBy);
  }

  // Get all tickets with pagination (admin)
  @Get()
  async getAll(
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Query('status') status: string,
  ) {
    return this.ticketsService.getAllTickets(
      parseInt(page) || 1,
      parseInt(limit) || 50,
      status,
    );
  }

  // Get stats (admin)
  @Get('stats')
  async getStats() {
    return this.ticketsService.getStats();
  }

  // Export all tickets as PDF (admin)
  @Get('export/pdf')
  async exportPDF(@Res() res: Response) {
    const pdfBuffer = await this.ticketsService.exportTicketsPDF();
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="holi-tickets-2026.pdf"',
      'Content-Length': pdfBuffer.length,
    });
    res.end(pdfBuffer);
  }

  // Get single ticket
  @Get(':ticketNumber')
  async getTicket(@Param('ticketNumber') ticketNumber: string) {
    return this.ticketsService.getTicketByNumber(ticketNumber.toUpperCase());
  }

  // Reset a ticket (admin)
  @Post(':ticketNumber/reset')
  @HttpCode(200)
  async resetTicket(@Param('ticketNumber') ticketNumber: string) {
    return this.ticketsService.resetTicket(ticketNumber.toUpperCase());
  }
}
