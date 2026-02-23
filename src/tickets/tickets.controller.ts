import {
  Controller,
  Post,
  Get,
  Patch,
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

  // Record entry after validation (volunteer)
  @Post('entry')
  @HttpCode(200)
  async recordEntry(
    @Body() body: { ticketNumber?: string; qrData?: string; scannedBy?: string },
    @Query('ticketNumber') ticketNumberQuery?: string,
  ) {
    return this.ticketsService.recordEntry(
      body.ticketNumber ?? body.qrData ?? ticketNumberQuery ?? '',
      body.scannedBy,
    );
  }

  // Validate ticket by number (volunteer) — must be after specific routes
  @Post(':ticketNumber')
  @HttpCode(200)
  async validateTicket(@Param('ticketNumber') ticketNumber: string) {
    return this.ticketsService.validateTicket(ticketNumber);
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

  // Get event settings (admin) — must come BEFORE :ticketNumber
  @Get('event-settings')
  async getEventSettings() {
    return this.ticketsService.getEventSettings();
  }

  // Update event settings for all tickets (admin)
  @Patch('event-settings')
  @HttpCode(200)
  async updateEventSettings(
    @Body() body: {
      eventName?: string;
      eventPlace?: string;
      eventDate?: string;
      eventTime?: string;
      organizer?: string;
    },
  ) {
    await this.ticketsService.updateEventSettings(body);
    return { message: 'Event settings updated for all tickets' };
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
