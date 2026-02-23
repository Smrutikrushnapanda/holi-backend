import { Controller, Post, Get, Body, Param, Query, HttpCode } from '@nestjs/common';
import { TicketsService } from './tickets/tickets.service';

@Controller()
export class PublicController {
  constructor(private readonly ticketsService: TicketsService) {}

  // Validate a ticket number (public endpoint)
  @Post(':ticketNumber')
  @HttpCode(200)
  async validateTicket(@Param('ticketNumber') ticketNumber: string) {
    return this.ticketsService.validateTicket(ticketNumber);
  }

  // Convenience GET for validation (e.g., browser hits)
  @Get(':ticketNumber')
  async validateTicketGet(@Param('ticketNumber') ticketNumber: string) {
    return this.ticketsService.validateTicket(ticketNumber);
  }

  // Record an entry (public endpoint)
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

  // Browser-friendly GET to mark entry
  @Get('entry/:ticketNumber')
  async recordEntryGet(
    @Param('ticketNumber') ticketNumber: string,
    @Query('scannedBy') scannedBy?: string,
  ) {
    return this.ticketsService.recordEntry(ticketNumber, scannedBy);
  }

  // POST with ticket in path
  @Post('entry/:ticketNumber')
  @HttpCode(200)
  async recordEntryPost(
    @Param('ticketNumber') ticketNumber: string,
    @Body() body: { scannedBy?: string },
  ) {
    return this.ticketsService.recordEntry(ticketNumber, body.scannedBy);
  }
}
