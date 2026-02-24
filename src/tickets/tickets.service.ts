import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import * as QRCode from 'qrcode';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

const DEFAULT_EVENT_NAME = 'Holi Hei! 2026';
const DEFAULT_EVENT_PLACE = 'Harapur,Near GD Goenka School,In front of DN Fairytale Appartment, Bhubaneswar, Odisha';
const DEFAULT_EVENT_DATE = '4th March 2026';
const DEFAULT_EVENT_TIME = '10:00 AM Onwards';
const DEFAULT_ORGANIZER = 'KALINGA BEATS';

// Optional brand marks placed on the ticket header (data URLs)
const DEFAULT_LEFT_LOGO = '';
const DEFAULT_RIGHT_LOGO = '';

export interface EventSettings {
  eventName: string;
  eventPlace: string;
  eventDate: string;
  eventTime: string;
  organizer: string;
  leftLogo?: string;
  rightLogo?: string;
}

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
        event_name VARCHAR(255) NOT NULL DEFAULT '${DEFAULT_EVENT_NAME}',
        event_place VARCHAR(255) NOT NULL DEFAULT '${DEFAULT_EVENT_PLACE}',
        event_date VARCHAR(100) NOT NULL DEFAULT '${DEFAULT_EVENT_DATE}',
        event_time VARCHAR(100) NOT NULL DEFAULT '${DEFAULT_EVENT_TIME}',
        organizer VARCHAR(255) NOT NULL DEFAULT '${DEFAULT_ORGANIZER}',
        status VARCHAR(20) NOT NULL DEFAULT 'unused',
        scanned_at TIMESTAMP,
        scanned_by VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW(),
        left_logo TEXT DEFAULT '${DEFAULT_LEFT_LOGO}',
        right_logo TEXT DEFAULT '${DEFAULT_RIGHT_LOGO}'
      )
    `);

    // Ensure logo columns exist for older databases
    await this.pool.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS left_logo TEXT DEFAULT '${DEFAULT_LEFT_LOGO}'`);
    await this.pool.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS right_logo TEXT DEFAULT '${DEFAULT_RIGHT_LOGO}'`);
  }

  async generateTickets(count: number = 200): Promise<{ generated: number; skipped: number }> {
    await this.initDB();

    // Get current event settings from existing tickets (if any)
    const { rows: settingsRows } = await this.pool.query(
      `SELECT event_name, event_place, event_date, event_time, organizer, left_logo, right_logo FROM tickets LIMIT 1`
    );
    const settings = settingsRows[0] ?? {
      event_name: DEFAULT_EVENT_NAME,
      event_place: DEFAULT_EVENT_PLACE,
      event_date: DEFAULT_EVENT_DATE,
      event_time: DEFAULT_EVENT_TIME,
      organizer: DEFAULT_ORGANIZER,
      left_logo: DEFAULT_LEFT_LOGO,
      right_logo: DEFAULT_RIGHT_LOGO,
    };

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
        event: settings.event_name,
        date: settings.event_date,
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
          `INSERT INTO tickets (ticket_number, qr_data, qr_image, event_name, event_place, event_date, event_time, organizer, left_logo, right_logo)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (ticket_number) DO NOTHING`,
          [ticketNumber, qrData, qrImage,
           settings.event_name, settings.event_place, settings.event_date,
           settings.event_time, settings.organizer, settings.left_logo, settings.right_logo]
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

  async getEventSettings(): Promise<EventSettings> {
    await this.initDB();
    const { rows } = await this.pool.query(
      `SELECT event_name, event_place, event_date, event_time, organizer, left_logo, right_logo FROM tickets ORDER BY id ASC LIMIT 1`
    );
    if (rows.length === 0) {
      return {
        eventName: DEFAULT_EVENT_NAME,
        eventPlace: DEFAULT_EVENT_PLACE,
        eventDate: DEFAULT_EVENT_DATE,
        eventTime: DEFAULT_EVENT_TIME,
        organizer: DEFAULT_ORGANIZER,
        leftLogo: DEFAULT_LEFT_LOGO,
        rightLogo: DEFAULT_RIGHT_LOGO,
      };
    }
    return {
      eventName: rows[0].event_name,
      eventPlace: rows[0].event_place,
      eventDate: rows[0].event_date,
      eventTime: rows[0].event_time,
      organizer: rows[0].organizer,
      leftLogo: rows[0].left_logo,
      rightLogo: rows[0].right_logo,
    };
  }

  async updateEventSettings(settings: Partial<EventSettings>): Promise<void> {
    await this.initDB();
    const updates: string[] = [];
    const values: string[] = [];
    let idx = 1;

    if (settings.eventName !== undefined) { updates.push(`event_name = $${idx++}`); values.push(settings.eventName); }
    if (settings.eventPlace !== undefined) { updates.push(`event_place = $${idx++}`); values.push(settings.eventPlace); }
    if (settings.eventDate !== undefined) { updates.push(`event_date = $${idx++}`); values.push(settings.eventDate); }
    if (settings.eventTime !== undefined) { updates.push(`event_time = $${idx++}`); values.push(settings.eventTime); }
    if (settings.organizer !== undefined) { updates.push(`organizer = $${idx++}`); values.push(settings.organizer); }
    if (settings.leftLogo !== undefined) { updates.push(`left_logo = $${idx++}`); values.push(settings.leftLogo); }
    if (settings.rightLogo !== undefined) { updates.push(`right_logo = $${idx++}`); values.push(settings.rightLogo); }

    if (updates.length === 0) return;
    await this.pool.query(`UPDATE tickets SET ${updates.join(', ')}`, values);
  }

  async scanTicket(qrData: string, scannedBy?: string) {
    const ticketNumber = this.extractTicketNumber(qrData);
    return this.recordEntry(ticketNumber, scannedBy);
  }

  async exportTicketsPDF(): Promise<Buffer> {
    await this.initDB();
    const { rows } = await this.pool.query(
      'SELECT ticket_number, qr_image, event_name, event_place, event_date, event_time, organizer, status, left_logo, right_logo FROM tickets ORDER BY id ASC'
    );

    const pdfDoc = await PDFDocument.create();
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // ── Layout constants ──────────────────────────────────────────
    // One ticket per row; four rows per page
    const COLS = 1;
    const ROWS_PER_PAGE = 4;
    const TICKETS_PER_PAGE = COLS * ROWS_PER_PAGE;
    const PAGE_WIDTH = 595;
    const PAGE_HEIGHT = 842;
    const HEADER_H = 46;          // top page header band

    const MARGIN_X = 18;
    const MARGIN_TOP = 12;         // below page header
    const MARGIN_BOT = 12;
    const GAP_Y = 12;

    const CARD_W = PAGE_WIDTH - MARGIN_X * 2;  // full width single column
    const AVAILABLE_H = PAGE_HEIGHT - HEADER_H - MARGIN_TOP - MARGIN_BOT;
    const CARD_H = Math.floor((AVAILABLE_H - GAP_Y * (ROWS_PER_PAGE - 1)) / ROWS_PER_PAGE);  // taller cards

    const COL_X = [MARGIN_X];

    // Row y = bottom of card (pdf-lib origin is bottom-left)
    const ROW_Y: number[] = [];
    for (let r = 0; r < ROWS_PER_PAGE; r++) {
      // top row first
      ROW_Y.push(PAGE_HEIGHT - HEADER_H - MARGIN_TOP - CARD_H - r * (CARD_H + GAP_Y));
    }

    // Festive Holi color palette
    const C_ORANGE  = rgb(0.98, 0.45, 0.08);
    const C_PINK    = rgb(0.95, 0.20, 0.55);
    const C_PURPLE  = rgb(0.52, 0.22, 0.80);
    const C_GREEN   = rgb(0.10, 0.68, 0.32);
    const C_YELLOW  = rgb(0.98, 0.80, 0.02);
    const C_CYAN    = rgb(0.05, 0.65, 0.80);
    const C_WHITE   = rgb(1, 1, 1);
    const C_DARK    = rgb(0.12, 0.08, 0.25);
    const C_GRAY    = rgb(0.45, 0.45, 0.50);
    const C_LGRAY   = rgb(0.93, 0.93, 0.95);
    const C_USED    = rgb(0.88, 0.15, 0.15);

    const BAND_COLORS = [C_ORANGE, C_PINK, C_PURPLE, C_GREEN, C_YELLOW, C_CYAN];
    const DOT_COLORS  = [C_PINK, C_YELLOW, C_GREEN, C_CYAN, C_PURPLE, C_ORANGE];

    const CARD_STRIP_H = 56;       // header strip height
    const QR_SIZE = 100;

    // Memoized logo embeds
    const logoCache = new Map<string, any>();

    async function embedLogo(dataUrl?: string) {
      if (!dataUrl) return null;
      if (logoCache.has(dataUrl)) return logoCache.get(dataUrl);
      try {
        const match = dataUrl.match(/^data:image\/(png|jpe?g);base64,(.*)$/i);
        if (!match) return null;
        const mime = match[1].toLowerCase();
        const bytes = Buffer.from(match[2], 'base64');
        const embed = mime === 'png'
          ? await pdfDoc.embedPng(bytes)
          : await pdfDoc.embedJpg(bytes);
        logoCache.set(dataUrl, embed);
        return embed;
      } catch {
        return null;
      }
    }

    function wrapText(text: string, font: any, fontSize: number, maxWidth: number): string[] {
      const cleaned = (text || '').replace(/\s+/g, ' ').trim();
      if (!cleaned) return ['-'];
      const words = cleaned.split(' ');
      const lines: string[] = [];
      let current = '';
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
          current = candidate;
        } else {
          if (current) lines.push(current);
          current = word;
        }
      }
      if (current) lines.push(current);
      return lines;
    }

    for (let i = 0; i < rows.length; i++) {
      const pageIndex = Math.floor(i / TICKETS_PER_PAGE);
      const pos       = i % TICKETS_PER_PAGE;
      const col       = pos % COLS;
      const row       = Math.floor(pos / COLS);

      // ── Add page on first ticket of each page ──
      if (pos === 0) {
        const pg = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

        // Page header: multi-color bands
        const bandW = PAGE_WIDTH / BAND_COLORS.length;
        BAND_COLORS.forEach((c, bi) => {
          pg.drawRectangle({ x: bi * bandW, y: PAGE_HEIGHT - HEADER_H, width: bandW + 1, height: HEADER_H, color: c });
        });
        pg.drawText('HOLI FESTIVAL 2026  ·  ENTRY TICKETS', {
          x: 152, y: PAGE_HEIGHT - 28, size: 13, font: boldFont, color: C_WHITE,
        });
      }

      const pg = pdfDoc.getPage(pageIndex);
      const x  = COL_X[col];
      const y  = ROW_Y[row];

      // ── Card background ──────────────────────────────────────
      pg.drawRectangle({
        x, y, width: CARD_W, height: CARD_H,
        color: C_WHITE,
        borderColor: C_PINK,
        borderWidth: 2,
        opacity: 0.99,
      });

      // ── Header strip with two logos ───────────────────────────
      pg.drawRectangle({
        x, y: y + CARD_H - CARD_STRIP_H,
        width: CARD_W, height: CARD_STRIP_H,
        color: C_WHITE,
      });

      const headerCenterX = x + CARD_W / 2;
      pg.drawRectangle({
        x, y: y + CARD_H - CARD_STRIP_H,
        width: CARD_W, height: CARD_STRIP_H,
        color: rgb(0.99, 0.90, 0.95),
        opacity: 0.65,
      });

      const leftLogo = rows[i].left_logo;
      const rightLogo = rows[i].right_logo;
      const logoSize = 52;
      const logoPadding = 8;

      const leftEmbed = await embedLogo(leftLogo);
      if (leftEmbed) {
        pg.drawImage(leftEmbed, {
          x: x + logoPadding,
          y: y + CARD_H - logoPadding - logoSize,
          width: logoSize,
          height: logoSize,
        });
      }

      const rightEmbed = await embedLogo(rightLogo);
      if (rightEmbed) {
        pg.drawImage(rightEmbed, {
          x: x + CARD_W - logoPadding - logoSize,
          y: y + CARD_H - logoPadding - logoSize,
          width: logoSize,
          height: logoSize,
        });
      }

      // Title in header
      pg.drawText('Holi Hai!', {
        x: headerCenterX - 54,
        y: y + CARD_H - CARD_STRIP_H + 20,
        size: 18,
        font: boldFont,
        color: C_PURPLE,
      });
      pg.drawText('Celebrate with us', {
        x: headerCenterX - 50,
        y: y + CARD_H - CARD_STRIP_H + 8,
        size: 9,
        font: regularFont,
        color: C_PINK,
      });

      // ── Ticket number & used badge ──────────────────────────
      pg.drawText(rows[i].ticket_number, {
        x: x + 14,
        y: y + CARD_H - CARD_STRIP_H - 18,
        size: 18,
        font: boldFont,
        color: C_DARK,
      });
      if (rows[i].status === 'used') {
        pg.drawText('USED', {
          x: x + CARD_W - 60,
          y: y + CARD_H - CARD_STRIP_H - 18,
          size: 10,
          font: boldFont,
          color: C_USED,
        });
      }

      // ── Details & QR layout ─────────────────────────────────
      const contentY = y + 18;
      const infoBoxWidth = CARD_W - QR_SIZE - 36;

      pg.drawRectangle({
        x: x + 12,
        y: contentY,
        width: infoBoxWidth,
        height: CARD_H - CARD_STRIP_H - 36,
        color: rgb(1, 0.98, 0.95),
        opacity: 0.75,
        borderColor: rgb(0.99, 0.8, 0.9),
        borderWidth: 1,
      });

      const details: Array<{ label: string; value: string; color: ReturnType<typeof rgb> }> = [
        { label: 'Live DJ · Rain Dance · Food · Colours', value: '', color: C_PURPLE },
        { label: 'Date',   value: rows[i].event_date, color: C_ORANGE },
        { label: 'Time',   value: rows[i].event_time, color: C_PINK },
        { label: 'Address', value: rows[i].event_place, color: C_GREEN },
        { label: 'Organizer', value: rows[i].organizer, color: C_CYAN },
      ];

      let lineY = y + CARD_H - CARD_STRIP_H - 30;
      details.forEach((d, idxDetail) => {
        const labelSize = idxDetail === 0 ? 9 : 8;
        const valueSize = idxDetail === 0 ? 0 : 10;
        if (idxDetail === 0) {
          pg.drawText(d.label, { x: x + 20, y: lineY, size: labelSize, font: boldFont, color: d.color });
          lineY -= 16;
          return;
        }
        const labelX = x + 20;
        const valueX = x + 100;
        const maxValueWidth = infoBoxWidth - (valueX - (x + 12)) - 12;
        pg.drawText(`${d.label}:`, { x: labelX, y: lineY, size: labelSize, font: boldFont, color: d.color });

        if (d.label === 'Address') {
          const addressLines = wrapText(d.value, regularFont, valueSize, maxValueWidth).slice(0, 3);
          addressLines.forEach((line, lineIndex) => {
            pg.drawText(line, {
              x: valueX,
              y: lineY - lineIndex * 12,
              size: valueSize,
              font: regularFont,
              color: C_DARK,
            });
          });
          lineY -= 12 * addressLines.length + 4;
          return;
        }

        pg.drawText(d.value || '-', { x: valueX, y: lineY, size: valueSize, font: regularFont, color: C_DARK });
        lineY -= 16;
      });

      // ── QR code box ─────────────────────────────────────────
      try {
        const qrBase64 = rows[i].qr_image.replace('data:image/png;base64,', '');
        const qrBytes  = Buffer.from(qrBase64, 'base64');
        const qrEmbed  = await pdfDoc.embedPng(qrBytes);
        const qrX = x + CARD_W - QR_SIZE - 16;
        const qrY = y + (CARD_H - CARD_STRIP_H - QR_SIZE) / 2 + 4;
        pg.drawRectangle({
          x: qrX - 6,
          y: qrY - 6,
          width: QR_SIZE + 12,
          height: QR_SIZE + 12,
          color: C_WHITE,
          borderColor: C_PURPLE,
          borderWidth: 1,
        });
        pg.drawImage(qrEmbed, { x: qrX, y: qrY, width: QR_SIZE, height: QR_SIZE });
      } catch {
        // silent QR embed failure
      }

      // ── Decorative splashes ─────────────────────────────────
      const dotData: Array<{ dx: number; dy: number; r: number; c: typeof C_ORANGE; op: number }> = [
        { dx: 18,          dy: 14,           r: 6, c: DOT_COLORS[0], op: 0.35 },
        { dx: 38,          dy: 10,           r: 4, c: DOT_COLORS[1], op: 0.30 },
        { dx: CARD_W - 24, dy: CARD_H - 62,  r: 6, c: DOT_COLORS[2], op: 0.25 },
        { dx: CARD_W - 12, dy: CARD_H - 78,  r: 4, c: DOT_COLORS[3], op: 0.20 },
        { dx: 60,          dy: 26,           r: 3, c: DOT_COLORS[4], op: 0.25 },
        { dx: 14,          dy: 32,           r: 3, c: DOT_COLORS[5], op: 0.20 },
      ];
      dotData.forEach(({ dx, dy, r, c, op }) => {
        pg.drawEllipse({ x: x + dx, y: y + dy, xScale: r, yScale: r, color: c, opacity: op });
      });

      // ── Footer ────────────────────────────────────────────────
      pg.drawText('Valid for one entry only · Non-transferable · Keep QR visible at gate', {
        x: x + 14, y: y + 8,
        size: 7, font: regularFont, color: C_GRAY,
      });
    }

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  }

  async getTicketByNumber(ticketNumber: string) {
    await this.initDB();
    if (!ticketNumber) {
      throw new BadRequestException('Ticket number is required');
    }
    const normalized = ticketNumber.trim().toUpperCase();
    const { rows } = await this.pool.query(
      'SELECT * FROM tickets WHERE UPPER(ticket_number) = $1',
      [normalized]
    );
    if (rows.length === 0) throw new NotFoundException('Ticket not found');
    return rows[0];
  }

  private extractTicketNumber(input: string): string {
    let ticketNumber: string | undefined;
    try {
      const parsed = JSON.parse(input);
      ticketNumber = parsed.ticket;
    } catch {
      ticketNumber = input;
    }
    const normalized = ticketNumber?.trim();
    if (!normalized) {
      throw new BadRequestException('Invalid QR code — ticket number missing');
    }
    return normalized;
  }

  async validateTicket(ticketNumberOrQr: string) {
    const ticketNumber = this.extractTicketNumber(ticketNumberOrQr);
    const ticket = await this.getTicketByNumber(ticketNumber);

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
      message: `Ticket ${ticketNumber} is valid`,
    };
  }

  async recordEntry(ticketInput: string, scannedBy?: string) {
    const ticketNumber = this.extractTicketNumber(ticketInput);
    const ticket = await this.getTicketByNumber(ticketNumber);

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

    // Atomically mark as used; if another process updated in between, rowCount will be 0.
    const { rows, rowCount } = await this.pool.query(
      `UPDATE tickets
         SET status = 'used', scanned_at = NOW(), scanned_by = $1
       WHERE UPPER(ticket_number) = $2 AND status != 'used'
       RETURNING *`,
      [scannedBy || 'Volunteer', ticketNumber.toUpperCase()]
    );

    if (rowCount === 0) {
      // Ticket exists but was just used concurrently
      const refreshed = await this.getTicketByNumber(ticketNumber);
      return {
        success: false,
        alreadyUsed: true,
        ticket: {
          ticket_number: refreshed.ticket_number,
          status: refreshed.status,
          scanned_at: refreshed.scanned_at,
          scanned_by: refreshed.scanned_by,
        },
        message: `Ticket ${ticketNumber} was already used at ${new Date(refreshed.scanned_at).toLocaleString()}`,
      };
    }

    const updated = rows[0];

    return {
      success: true,
      alreadyUsed: false,
      ticket: {
        ticket_number: updated.ticket_number,
        event_name: updated.event_name,
        event_place: updated.event_place,
        event_date: updated.event_date,
        event_time: updated.event_time,
        scanned_at: updated.scanned_at,
        scanned_by: updated.scanned_by,
      },
      message: `Welcome! Ticket ${ticketNumber} validated successfully.`,
    };
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
