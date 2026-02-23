import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import * as QRCode from 'qrcode';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

const EVENT_NAME = 'Holi Festival 2026';
const EVENT_PLACE = 'Festival Ground, Bhubaneswar, Odisha';
const EVENT_DATE = '14th March 2026';
const EVENT_TIME = '04:00 PM Onwards';
const ORGANIZER = 'Holi Committee 2026';

@Injectable()
export class TicketsService {
  constructor(@Inject('DB_POOL') private readonly pool: Pool) {}

  async initDB() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS tickets (
        id SERIAL PRIMARY KEY,
        ticket_number VARCHAR(20) UNIQUE NOT NULL,
        qr_data TEXT NOT NULL,
        qr_image TEXT NOT NULL,
        event_name VARCHAR(255) NOT NULL DEFAULT '${EVENT_NAME}',
        event_place VARCHAR(255) NOT NULL DEFAULT '${EVENT_PLACE}',
        event_date VARCHAR(100) NOT NULL DEFAULT '${EVENT_DATE}',
        event_time VARCHAR(100) NOT NULL DEFAULT '${EVENT_TIME}',
        organizer VARCHAR(255) NOT NULL DEFAULT '${ORGANIZER}',
        status VARCHAR(20) NOT NULL DEFAULT 'unused',
        scanned_at TIMESTAMP,
        scanned_by VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
  }

  async generateTickets(count: number = 200): Promise<{ generated: number; skipped: number }> {
    await this.initDB();

    // Only count tickets with the HOLI-NNN numeric format
    const { rows: existing } = await this.pool.query(
      `SELECT MAX(CAST(SUBSTRING(ticket_number, 6) AS INTEGER)) as max_num
       FROM tickets
       WHERE ticket_number ~ '^HOLI-[0-9]+$'`
    );
    const startFrom = (existing[0]?.max_num || 0) + 1;
    const endAt = startFrom + count - 1;

    let generated = 0;
    let skipped = 0;

    for (let i = startFrom; i <= endAt; i++) {
      const ticketNumber = `HOLI-${String(i).padStart(3, '0')}`;
      const qrData = JSON.stringify({
        ticket: ticketNumber,
        event: EVENT_NAME,
        date: EVENT_DATE,
        secret: Buffer.from(`${ticketNumber}:holi2026secret`).toString('base64'),
      });

      try {
        const qrImage = await QRCode.toDataURL(qrData, {
          width: 300,
          margin: 2,
          color: { dark: '#1a1a2e', light: '#ffffff' },
          errorCorrectionLevel: 'H',
        });

        await this.pool.query(
          `INSERT INTO tickets (ticket_number, qr_data, qr_image, event_name, event_place, event_date, event_time, organizer)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (ticket_number) DO NOTHING`,
          [ticketNumber, qrData, qrImage, EVENT_NAME, EVENT_PLACE, EVENT_DATE, EVENT_TIME, ORGANIZER]
        );
        generated++;
      } catch {
        skipped++;
      }
    }

    return { generated, skipped };
  }

  async getAllTickets(page = 1, limit = 50, status?: string) {
    await this.initDB();
    const offset = (page - 1) * limit;

    let whereClause = '';
    const params: (string | number)[] = [limit, offset];

    if (status && ['used', 'unused'].includes(status)) {
      whereClause = `WHERE status = $3`;
      params.push(status);
    }

    const { rows } = await this.pool.query(
      `SELECT id, ticket_number, event_name, event_place, event_date, event_time,
              organizer, status, scanned_at, scanned_by, created_at
       FROM tickets ${whereClause}
       ORDER BY id ASC
       LIMIT $1 OFFSET $2`,
      params
    );

    const { rows: countRows } = await this.pool.query(
      `SELECT COUNT(*) as total FROM tickets ${whereClause}`,
      status ? [status] : []
    );

    return {
      tickets: rows,
      total: parseInt(countRows[0].total),
      page,
      limit,
      totalPages: Math.ceil(parseInt(countRows[0].total) / limit),
    };
  }

  async getStats() {
    await this.initDB();
    const { rows } = await this.pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'used' THEN 1 END) as used,
        COUNT(CASE WHEN status = 'unused' THEN 1 END) as unused
      FROM tickets
    `);
    return {
      total: parseInt(rows[0].total),
      used: parseInt(rows[0].used),
      unused: parseInt(rows[0].unused),
    };
  }

  async scanTicket(qrData: string, scannedBy?: string) {
    await this.initDB();

    let ticketNumber: string;
    try {
      const parsed = JSON.parse(qrData);
      ticketNumber = parsed.ticket;
    } catch {
      throw new BadRequestException('Invalid QR code format');
    }

    if (!ticketNumber) {
      throw new BadRequestException('Invalid QR code — ticket number missing');
    }

    const { rows } = await this.pool.query(
      'SELECT * FROM tickets WHERE ticket_number = $1',
      [ticketNumber]
    );

    if (rows.length === 0) {
      throw new NotFoundException(`Ticket ${ticketNumber} not found`);
    }

    const ticket = rows[0];

    if (ticket.status === 'used') {
      return {
        success: false,
        alreadyUsed: true,
        ticket: {
          ticket_number: ticket.ticket_number,
          status: ticket.status,
          scanned_at: ticket.scanned_at,
          scanned_by: ticket.scanned_by,
        },
        message: `Ticket ${ticketNumber} was already used at ${new Date(ticket.scanned_at).toLocaleString()}`,
      };
    }

    await this.pool.query(
      `UPDATE tickets SET status = 'used', scanned_at = NOW(), scanned_by = $1 WHERE ticket_number = $2`,
      [scannedBy || 'Volunteer', ticketNumber]
    );

    return {
      success: true,
      alreadyUsed: false,
      ticket: {
        ticket_number: ticket.ticket_number,
        event_name: ticket.event_name,
        event_place: ticket.event_place,
        event_date: ticket.event_date,
        event_time: ticket.event_time,
      },
      message: `Welcome! Ticket ${ticketNumber} validated successfully.`,
    };
  }

  async exportTicketsPDF(): Promise<Buffer> {
    await this.initDB();
    const { rows } = await this.pool.query(
      'SELECT ticket_number, qr_image, event_name, event_place, event_date, event_time, status FROM tickets ORDER BY id ASC'
    );

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const TICKETS_PER_PAGE = 4;
    const PAGE_WIDTH = 595;
    const PAGE_HEIGHT = 842;
    const CARD_WIDTH = 260;
    const CARD_HEIGHT = 180;
    const MARGIN = 20;
    const QR_SIZE = 100;

    const cols = 2;
    const rows_per_page = 2;

    const colPositions = [MARGIN + 10, PAGE_WIDTH / 2 + MARGIN / 2];
    const rowPositions = [
      PAGE_HEIGHT - MARGIN - CARD_HEIGHT - 40,
      PAGE_HEIGHT - MARGIN - CARD_HEIGHT * 2 - 80,
    ];

    for (let i = 0; i < rows.length; i++) {
      const pageIndex = Math.floor(i / TICKETS_PER_PAGE);
      const posOnPage = i % TICKETS_PER_PAGE;
      const col = posOnPage % cols;
      const row = Math.floor(posOnPage / cols);

      if (posOnPage === 0) {
        const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

        // Page header
        page.drawRectangle({
          x: 0,
          y: PAGE_HEIGHT - 40,
          width: PAGE_WIDTH,
          height: 40,
          color: rgb(0.98, 0.36, 0.1),
        });
        page.drawText('HOLI FESTIVAL 2026 — ENTRY TICKETS', {
          x: 100,
          y: PAGE_HEIGHT - 28,
          size: 14,
          font,
          color: rgb(1, 1, 1),
        });
      }

      const page = pdfDoc.getPage(pageIndex);
      const x = colPositions[col];
      const y = rowPositions[row];

      // Card background
      page.drawRectangle({
        x,
        y,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        color: rgb(0.98, 0.98, 0.98),
        borderColor: rgb(0.85, 0.3, 0.1),
        borderWidth: 2,
      });

      // Ticket header strip
      page.drawRectangle({
        x,
        y: y + CARD_HEIGHT - 30,
        width: CARD_WIDTH,
        height: 30,
        color: rgb(0.98, 0.36, 0.1),
      });

      page.drawText(EVENT_NAME.toUpperCase(), {
        x: x + 8,
        y: y + CARD_HEIGHT - 20,
        size: 9,
        font,
        color: rgb(1, 1, 1),
      });

      // Ticket number
      page.drawText(rows[i].ticket_number, {
        x: x + 8,
        y: y + CARD_HEIGHT - 50,
        size: 14,
        font,
        color: rgb(0.15, 0.1, 0.4),
      });

      // Status badge
      const statusColor = rows[i].status === 'used' ? rgb(0.9, 0.2, 0.2) : rgb(0.1, 0.7, 0.3);
      page.drawText(rows[i].status.toUpperCase(), {
        x: x + CARD_WIDTH - 55,
        y: y + CARD_HEIGHT - 50,
        size: 8,
        font,
        color: statusColor,
      });

      // Event details (text)
      const details = [
        `Date: ${rows[i].event_date}`,
        `Time: ${rows[i].event_time}`,
        `Venue: ${EVENT_PLACE.split(',')[0]}`,
        `Odisha`,
      ];
      details.forEach((line, idx) => {
        page.drawText(line, {
          x: x + 8,
          y: y + CARD_HEIGHT - 68 - idx * 14,
          size: 7.5,
          font: regularFont,
          color: rgb(0.2, 0.2, 0.2),
        });
      });

      // QR code
      try {
        const qrBase64 = rows[i].qr_image.replace('data:image/png;base64,', '');
        const qrBytes = Buffer.from(qrBase64, 'base64');
        const qrEmbedded = await pdfDoc.embedPng(qrBytes);
        page.drawImage(qrEmbedded, {
          x: x + CARD_WIDTH - QR_SIZE - 10,
          y: y + 10,
          width: QR_SIZE,
          height: QR_SIZE,
        });
      } catch {
        // QR embed failed silently
      }

      // Divider line
      page.drawLine({
        start: { x: x + CARD_WIDTH - QR_SIZE - 18, y: y + 10 },
        end: { x: x + CARD_WIDTH - QR_SIZE - 18, y: y + CARD_HEIGHT - 32 },
        thickness: 0.5,
        color: rgb(0.8, 0.8, 0.8),
      });

      // Footer
      page.drawText('Valid for one entry only • Non-transferable', {
        x: x + 8,
        y: y + 6,
        size: 6,
        font: regularFont,
        color: rgb(0.5, 0.5, 0.5),
      });
    }

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  }

  async getTicketByNumber(ticketNumber: string) {
    await this.initDB();
    const { rows } = await this.pool.query(
      'SELECT * FROM tickets WHERE ticket_number = $1',
      [ticketNumber]
    );
    if (rows.length === 0) throw new NotFoundException('Ticket not found');
    return rows[0];
  }

  async resetTicket(ticketNumber: string) {
    await this.initDB();
    const { rows } = await this.pool.query(
      `UPDATE tickets SET status = 'unused', scanned_at = NULL, scanned_by = NULL
       WHERE ticket_number = $1 RETURNING *`,
      [ticketNumber]
    );
    if (rows.length === 0) throw new NotFoundException('Ticket not found');
    return rows[0];
  }
}
