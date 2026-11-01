#!/usr/bin/env python3
"""Color step-by-step manuals for TANK Tickets."""

from reportlab.lib.colors import Color, white, black
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageTemplate,
    NextPageTemplate,
    PageBreak,
    Paragraph,
    Spacer,
    Flowable,
    KeepTogether,
    ListFlowable,
    ListItem,
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas as pdfcanvas

INK = Color(0.047, 0.047, 0.043)
CREAM = Color(0.937, 0.910, 0.847)
GOLD = Color(0.788, 0.635, 0.153)
GOLD_DEEP = Color(0.66, 0.52, 0.10)
PAPER = Color(0.969, 0.949, 0.902)
MUTED = Color(0.35, 0.33, 0.30)
GREEN = Color(0.07, 0.42, 0.24)
RED = Color(0.56, 0.11, 0.08)
W, H = A4


def P(text, style):
    return Paragraph(text, style)


STYLES = {
    "h1": ParagraphStyle("h1", fontName="Times-Bold", fontSize=22, leading=24, textColor=INK, spaceAfter=6),
    "h2": ParagraphStyle("h2", fontName="Times-Bold", fontSize=13, leading=16, textColor=INK, spaceBefore=2, spaceAfter=2),
    "body": ParagraphStyle("body", fontName="Times-Roman", fontSize=10.5, leading=14.2, textColor=INK),
    "small": ParagraphStyle("small", fontName="Times-Roman", fontSize=9, leading=12.2, textColor=MUTED),
    "gold": ParagraphStyle("gold", fontName="Times-Bold", fontSize=8.5, leading=11, textColor=GOLD_DEEP, tracking=1),
    "white": ParagraphStyle("white", fontName="Times-Roman", fontSize=10.5, leading=14, textColor=CREAM),
    "step": ParagraphStyle("step", fontName="Times-Bold", fontSize=12, leading=15, textColor=INK),
    "li": ParagraphStyle("li", fontName="Times-Roman", fontSize=10, leading=13.2, textColor=INK, leftIndent=0),
}


class Phone(Flowable):
    """A small illustrated phone screen."""

    def __init__(self, kind, width=42 * mm, height=72 * mm):
        super().__init__()
        self.kind = kind
        self.width = width
        self.height = height

    def draw(self):
        c = self.canv
        w, h = self.width, self.height
        c.setFillColor(INK)
        c.roundRect(0, 0, w, h, 8, fill=1, stroke=0)
        c.setFillColor(CREAM)
        c.roundRect(2.2, 2.2, w - 4.4, h - 4.4, 6.5, fill=1, stroke=0)
        c.setFillColor(INK)
        c.rect(2.2, h - 11, w - 4.4, 8.8, fill=1, stroke=0)
        c.setFillColor(GOLD)
        c.circle(8, h - 6.6, 2.1, fill=1, stroke=0)
        c.setFillColor(CREAM)
        c.setFont("Times-Bold", 5.2)
        c.drawString(12, h - 8.2, "TANK TICKETS")
        draw_screen(c, self.kind, 5, 6, w - 10, h - 20)


def draw_screen(c, kind, x, y, w, h):
    c.saveState()
    if kind == "search":
        c.setFillColor(INK)
        c.roundRect(x, y + h - 16, w, 14, 2, fill=1, stroke=0)
        c.setFillColor(GOLD)
        c.setFont("Times-Bold", 5)
        c.drawString(x + 3, y + h - 11, "Search events")
        for i, label in enumerate(["Tonight", "Weekend", "Live"]):
            c.setFillColor(GOLD if i == 0 else Color(0.9, 0.88, 0.82))
            c.roundRect(x + i * 28, y + h - 28, 26, 8, 2, fill=1, stroke=0)
        for i in range(3):
            yy = y + h - 46 - i * 22
            c.setFillColor(Color(0.93, 0.9, 0.84))
            c.rect(x, yy, 16, 16, fill=1, stroke=0)
            c.setFillColor(INK)
            c.setFont("Times-Bold", 5.5)
            c.drawString(x + 19, yy + 9, ["Amapiano Night", "Jazz Session", "Rooftop Party"][i])
            c.setFillColor(MUTED)
            c.setFont("Times-Roman", 4.5)
            c.drawString(x + 19, yy + 3, "Kampala  ·  UGX")
    elif kind == "event":
        c.setFillColor(Color(0.12, 0.11, 0.1))
        c.rect(x, y + h - 28, w, 26, fill=1, stroke=0)
        c.setFillColor(GOLD)
        c.circle(x + w / 2, y + h - 15, 7, fill=1, stroke=0)
        c.setFillColor(INK)
        c.setFont("Times-Bold", 6)
        c.drawString(x, y + h - 38, "KAMPALA NIGHT")
        c.setFillColor(MUTED)
        c.setFont("Times-Roman", 4.5)
        c.drawString(x, y + h - 46, "Sat  ·  Kololo  ·  9:00 PM")
        c.setFillColor(GOLD)
        c.roundRect(x, y + 8, w, 12, 2, fill=1, stroke=0)
        c.setFillColor(INK)
        c.setFont("Times-Bold", 6)
        c.drawCentredString(x + w / 2, y + 12, "GET TICKETS")
    elif kind == "pay":
        c.setFillColor(INK)
        c.setFont("Times-Bold", 6)
        c.drawString(x, y + h - 8, "CHECKOUT")
        c.setStrokeColor(Color(0.8, 0.76, 0.68))
        c.setFillColor(white)
        for i, lab in enumerate(["Full name", "0772 123456", "Email"]):
            c.roundRect(x, y + h - 24 - i * 14, w, 11, 1.5, fill=1, stroke=1)
            c.setFillColor(MUTED)
            c.setFont("Times-Roman", 4.5)
            c.drawString(x + 2, y + h - 20 - i * 14, lab)
            c.setFillColor(white)
        c.setFillColor(GOLD)
        c.roundRect(x, y + 6, w, 12, 2, fill=1, stroke=0)
        c.setFillColor(INK)
        c.setFont("Times-Bold", 5.5)
        c.drawCentredString(x + w / 2, y + 10, "PAY  ·  MTN / AIRTEL")
    elif kind == "pin":
        c.setFillColor(Color(0.95, 0.78, 0.25))
        c.roundRect(x, y + h - 22, w, 18, 2, fill=1, stroke=0)
        c.setFillColor(INK)
        c.setFont("Times-Bold", 5)
        c.drawString(x + 3, y + h - 12, "Approve on your phone")
        c.setFont("Times-Roman", 4.5)
        c.drawString(x + 3, y + h - 18, "Enter Mobile Money PIN")
        c.setFillColor(INK)
        c.roundRect(x + 8, y + 18, w - 16, 22, 3, fill=1, stroke=0)
        c.setFillColor(GOLD)
        c.setFont("Times-Bold", 8)
        c.drawCentredString(x + w / 2, y + 26, "PIN")
    elif kind == "ticket":
        c.setFillColor(white)
        c.roundRect(x, y + 4, w, h - 6, 2, fill=1, stroke=0)
        c.setStrokeColor(GOLD)
        c.setLineWidth(1)
        c.rect(x + w - 28, y + 16, 22, 22, fill=0, stroke=1)
        c.setFillColor(INK)
        for i in range(4):
            for j in range(4):
                if (i + j) % 2 == 0:
                    c.rect(x + w - 26 + i * 4.5, y + 18 + j * 4.5, 3.2, 3.2, fill=1, stroke=0)
        c.setFont("Times-Bold", 5.5)
        c.drawString(x + 3, y + h - 14, "YOU'RE IN")
        c.setFillColor(GOLD_DEEP)
        c.setFont("Times-Bold", 6)
        c.drawString(x + 3, y + 22, "TNK-")
        c.setFillColor(GREEN)
        c.setFont("Times-Roman", 4.5)
        c.drawString(x + 3, y + 10, "Valid ticket")
    elif kind == "form":
        c.setFillColor(INK)
        c.setFont("Times-Bold", 5.5)
        c.drawString(x, y + h - 8, "LIST A NEW EVENT")
        c.setFillColor(white)
        c.setStrokeColor(Color(0.75, 0.7, 0.62))
        for i in range(4):
            c.roundRect(x, y + h - 22 - i * 12, w, 9, 1, fill=1, stroke=1)
        c.setFillColor(INK)
        c.roundRect(x, y + 4, w, 11, 2, fill=1, stroke=0)
        c.setFillColor(CREAM)
        c.setFont("Times-Bold", 5)
        c.drawCentredString(x + w / 2, y + 8, "SUBMIT EVENT")
    elif kind == "review":
        c.setFillColor(Color(0.98, 0.94, 0.78))
        c.roundRect(x, y + h - 16, 28, 8, 1, fill=1, stroke=0)
        c.setFillColor(GOLD_DEEP)
        c.setFont("Times-Bold", 4.5)
        c.drawString(x + 2, y + h - 13.5, "IN REVIEW")
        c.setFillColor(INK)
        c.setFont("Times-Bold", 5.5)
        c.drawString(x, y + h - 26, "New event")
        c.setFillColor(GREEN)
        c.roundRect(x, y + 8, w * 0.46, 12, 2, fill=1, stroke=0)
        c.setFillColor(white)
        c.setFont("Times-Bold", 5)
        c.drawCentredString(x + w * 0.23, y + 12, "APPROVE")
        c.setStrokeColor(INK)
        c.setFillColor(CREAM)
        c.roundRect(x + w * 0.52, y + 8, w * 0.46, 12, 2, fill=1, stroke=1)
        c.setFillColor(INK)
        c.drawCentredString(x + w * 0.75, y + 12, "REJECT")
    elif kind == "door":
        c.setFillColor(INK)
        c.roundRect(x + 8, y + 22, w - 16, w - 16, 2, fill=1, stroke=0)
        c.setStrokeColor(GOLD)
        c.setLineWidth(1.4)
        c.rect(x + 14, y + 28, w - 28, w - 28, fill=0, stroke=1)
        c.setFillColor(GOLD)
        c.setFont("Times-Bold", 5)
        c.drawCentredString(x + w / 2, y + 10, "SCAN QR")
    else:
        c.setFillColor(INK)
        c.setFont("Times-Roman", 6)
        c.drawString(x, y + 10, kind)
    c.restoreState()


class StepCard(Flowable):
    def __init__(self, number, title, lines, screen, width):
        super().__init__()
        self.number = number
        self.title = title
        self.lines = lines
        self.screen = screen
        self.width = width
        self.height = 78 * mm

    def draw(self):
        c = self.canv
        w, h = self.width, self.height
        c.setFillColor(PAPER)
        c.roundRect(0, 0, w, h, 6, fill=1, stroke=0)
        c.setFillColor(GOLD)
        c.circle(12 * mm, h - 12 * mm, 7 * mm, fill=1, stroke=0)
        c.setFillColor(INK)
        c.setFont("Times-Bold", 12)
        c.drawCentredString(12 * mm, h - 13.6 * mm, str(self.number))
        c.setFont("Times-Bold", 12)
        c.drawString(22 * mm, h - 11 * mm, self.title)
        text = c.beginText(22 * mm, h - 18 * mm)
        text.setFont("Times-Roman", 9.5)
        text.setFillColor(INK)
        text.setLeading(12.4)
        for line in self.lines:
            text.textLine(line)
        c.drawText(text)
        phone = Phone(self.screen)
        c.saveState()
        c.translate(w - 48 * mm, 4 * mm)
        phone.canv = c
        phone.draw()
        c.restoreState()


class Tip(Flowable):
    def __init__(self, title, body, width, tone="gold"):
        super().__init__()
        self.title = title
        self.body = body
        self.width = width
        self.tone = tone
        self.height = 22 * mm

    def wrap(self, aw, ah):
        self.width = aw
        return aw, self.height

    def draw(self):
        c = self.canv
        bar = {"gold": GOLD, "green": GREEN, "red": RED}[self.tone]
        c.setFillColor(Color(0.98, 0.96, 0.92))
        c.roundRect(0, 0, self.width, self.height, 4, fill=1, stroke=0)
        c.setFillColor(bar)
        c.rect(0, 0, 3.2, self.height, fill=1, stroke=0)
        c.setFillColor(INK)
        c.setFont("Times-Bold", 9)
        c.drawString(8, self.height - 6.5 * mm, self.title)
        text = c.beginText(8, self.height - 11.5 * mm)
        text.setFont("Times-Roman", 8.6)
        text.setFillColor(MUTED)
        text.setLeading(11)
        for line in self.body:
            text.textLine(line)
        c.drawText(text)


def draw_cover(c, doc, meta):
    c.saveState()
    c.setFillColor(INK)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    img = meta["cover"]
    c.drawImage(img, 0, 78 * mm, width=W, height=H - 78 * mm, preserveAspectRatio=True, anchor="c", mask="auto")
    c.setFillColor(Color(0.047, 0.047, 0.043, alpha=0.55))
    c.rect(0, 78 * mm, W, H - 78 * mm, fill=1, stroke=0)
    c.setFillColor(INK)
    c.rect(0, 0, W, 86 * mm, fill=1, stroke=0)
    c.setFillColor(GOLD)
    c.rect(18 * mm, 78 * mm, 42 * mm, 2.2, fill=1, stroke=0)
    c.setFillColor(GOLD)
    c.setFont("Times-Bold", 9)
    c.drawString(18 * mm, 68 * mm, meta["kicker"].upper())
    c.setFillColor(CREAM)
    c.setFont("Times-Bold", 26)
    title_top = 58 * mm
    for i, line in enumerate(meta["title"]):
        c.drawString(18 * mm, title_top - i * 9.2 * mm, line)
    blurb_top = title_top - len(meta["title"]) * 9.2 * mm - 6 * mm
    c.setFillColor(Color(0.85, 0.82, 0.74))
    c.setFont("Times-Roman", 11)
    text = c.beginText(18 * mm, blurb_top)
    text.setFont("Times-Roman", 11)
    text.setFillColor(Color(0.85, 0.82, 0.74))
    text.setLeading(14)
    for line in meta["blurb"]:
        text.textLine(line)
    c.drawText(text)
    c.setFillColor(GOLD)
    c.setFont("Times-Bold", 8)
    c.drawString(18 * mm, 12 * mm, "TANK PROMOTIONS  ·  KAMPALA  ·  tanktickets.site")
    c.restoreState()


def draw_page(c, doc, meta):
    c.saveState()
    c.setFillColor(CREAM)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    c.setFillColor(INK)
    c.rect(0, H - 12 * mm, W, 12 * mm, fill=1, stroke=0)
    c.setFillColor(GOLD)
    c.circle(12 * mm, H - 6 * mm, 2.1 * mm, fill=1, stroke=0)
    c.setFillColor(CREAM)
    c.setFont("Times-Bold", 8)
    c.drawString(16 * mm, H - 7.2 * mm, "TANK TICKETS")
    c.setFont("Times-Roman", 8)
    c.drawRightString(W - 12 * mm, H - 7.2 * mm, meta["short"])
    c.setFillColor(INK)
    c.rect(0, 0, W, 10 * mm, fill=1, stroke=0)
    c.setFillColor(GOLD)
    c.setFont("Times-Roman", 8)
    c.drawString(12 * mm, 4 * mm, "Kila Sekunde Ina Hesabu")
    c.setFillColor(CREAM)
    c.drawRightString(W - 12 * mm, 4 * mm, str(c.getPageNumber()))
    c.restoreState()


def make_doc(path, meta, story):
    doc = BaseDocTemplate(
        path,
        pagesize=A4,
        title=meta["pdf_title"],
        author="TANK Promotions Co. Ltd",
        subject="Step-by-step guide for tanktickets.site",
    )
    cover = PageTemplate(id="cover", frames=[Frame(0, 0, W, H, id="c")], onPage=lambda c, d: draw_cover(c, d, meta))
    inner = PageTemplate(
        id="inner",
        frames=[Frame(14 * mm, 16 * mm, W - 28 * mm, H - 32 * mm, id="i")],
        onPage=lambda c, d: draw_page(c, d, meta),
    )
    doc.addPageTemplates([cover, inner])
    doc.build(story)


def story_for(meta, sections):
    story = [NextPageTemplate("inner"), PageBreak()]
    story.append(P("INSIDE THIS GUIDE", STYLES["gold"]))
    story.append(Spacer(1, 2 * mm))
    story.append(P(meta["intro"], STYLES["body"]))
    story.append(Spacer(1, 4 * mm))
    for title, paragraphs, steps, tips in sections:
        story.append(Spacer(1, 4 * mm))
        story.append(P(title, STYLES["h1"]))
        for para in paragraphs:
            story.append(P(para, STYLES["body"]))
            story.append(Spacer(1, 2 * mm))
        for step in steps:
            story.append(Spacer(1, 3 * mm))
            story.append(StepCard(step[0], step[1], step[2], step[3], W - 28 * mm))
        for tip in tips:
            story.append(Spacer(1, 3 * mm))
            story.append(Tip(tip[0], tip[1], W - 28 * mm, tip[2] if len(tip) > 2 else "gold"))
        story.append(Spacer(1, 2 * mm))
    story.append(Spacer(1, 6 * mm))
    story.append(P("NEED A PERSON?", STYLES["gold"]))
    story.append(P("WhatsApp TANK", STYLES["h1"]))
    story.append(P("Message +256 775 497 509. Say whether you are buying a ticket, listing an event, or working the door. Include the event name and, if you have one, the ticket code that starts with TNK-.", STYLES["body"]))
    return story


BUYER = {
    "pdf_title": "TANK Tickets — Buyer guide",
    "short": "Buyer guide",
    "kicker": "For guests",
    "title": ["Buy a ticket.", "Walk in."],
    "blurb": ["Find a Kampala event, pay with MTN or Airtel", "Mobile Money, and show your QR code at the door."],
    "cover": "manuals/images/cover-buyer.jpg",
    "intro": "This guide is for anyone buying a ticket on tanktickets.site. You do not need an account to buy. Create one only if you want every ticket saved under My tickets.",
}

ORGANIZER = {
    "pdf_title": "TANK Tickets — Organizer guide",
    "short": "Organizer guide",
    "kicker": "For organizers",
    "title": ["List it.", "Sell it.", "Scan them in."],
    "blurb": ["Put your event on TANK Tickets, share one link,", "and check guests in with your phone camera."],
    "cover": "manuals/images/cover-organizer.jpg",
    "intro": "This guide is for promoters, venues and hosts who sell their own tickets. TANK reviews each new event before it appears on the public site.",
}

ADMIN = {
    "pdf_title": "TANK Tickets — Admin guide",
    "short": "Admin guide",
    "kicker": "For the TANK desk",
    "title": ["Approve.", "Watch sales.", "Open the door."],
    "blurb": ["The admin desk is only for admin@tanktickets.site.", "It is not linked from the front page."],
    "cover": "manuals/images/cover-admin.jpg",
    "intro": "This guide is for the TANK Promotions desk. Bookmark the admin address. Do not share the admin password, and do not put a live ZengaPay token in the browser.",
}


def buyer_sections():
    return [
        (
            "Find an event",
            ["Open the site, search, then open the event page before you pay."],
            [
                (1, "Open the site", ["Go to tanktickets.site.", "If the browser warns about the lock,", "use http://tanktickets.site until", "the security certificate is ready."], "search"),
                (2, "Search and filter", ["Type a name, venue or area.", "Tap Today, This weekend, Next 7 days", "or This month. Category chips appear", "when more than one type is on sale."], "search"),
                (3, "Open the event", ["Tap the card. Check the date, start", "time, venue and how many tickets", "are left. Open in Google Maps if you", "need directions."], "event"),
            ],
            [("Sold out or ended", ["Get tickets stays grey. Pick another event, or ask the organizer on WhatsApp from the event page."], "red")],
        ),
        (
            "Pay and collect the ticket",
            ["You can buy 1 to 10 tickets. The price is set by the event. A price of Free needs no Mobile Money PIN."],
            [
                (4, "Choose how many", ["Tap Get tickets. Use minus and plus.", "Tap Continue. The total is shown", "on the button."], "event"),
                (5, "Enter your details", ["Full name, a Ugandan mobile number", "such as 0772 123456, and your email.", "The same number receives the", "Mobile Money prompt."], "pay"),
                (6, "Approve the PIN", ["A prompt arrives on that phone.", "Enter your MTN or Airtel PIN.", "This page waits and then confirms.", "Do not close it yet."], "pin"),
                (7, "Keep the ticket", ["You will see You're on the list.", "Tap Send to WhatsApp. If email is", "set up, the ticket is also emailed.", "Save the QR image as a backup."], "ticket"),
            ],
            [("Test mode", ["If the page says test mode, no money is taken. A gold button lets you simulate approval. Real events will ask for a real PIN."])],
        ),
        (
            "At the door, and if you lose it",
            ["The QR code is the ticket. A screenshot is fine if the code is sharp and the screen is bright."],
            [
                (8, "Show the QR", ["Open the WhatsApp message, the", "email link, or My tickets. Turn", "brightness up. The door team scans", "it once. A used ticket will not scan again."], "ticket"),
                (9, "Find a lost ticket", ["Sign in with the same email you", "used to buy. Open My tickets.", "Or open the link that was sent.", "Still stuck? WhatsApp TANK."], "search"),
            ],
            [("Account is optional", ["Buying does not require Sign in. An account is useful if you buy more than one event and want them in one list."], "green")],
        ),
    ]


def organizer_sections():
    return [
        (
            "Create the event",
            ["Start from Sell tickets. New events stay hidden until TANK approves them."],
            [
                (1, "Create an account", ["Tap Sell tickets or Start selling.", "Enter your name, WhatsApp number,", "email and a password of at least", "8 characters. Then tap Create account."], "form"),
                (2, "Fill in the night", ["Event name, venue, area, date and", "start time, category, price in UGX,", "and how many tickets exist. Use 0", "if entry is free."], "form"),
                (3, "Add the poster", ["Upload a clear poster. Write the", "line-up, dress code and what is", "included. Check the organizer", "WhatsApp number, then Submit event."], "form"),
            ],
            [("You can preview it", ["While it says In review, only you can open the event page. Guests cannot buy yet."])],
        ),
        (
            "After TANK approves it",
            ["The status changes from In review to Live. Share that link everywhere you promote the night."],
            [
                (4, "Share one link", ["On My events, tap Share link.", "Send it on WhatsApp and socials.", "Guests land on your event page", "and pay there. You do not collect cash."], "event"),
                (5, "Watch sales", ["Open Sales. You will see money", "collected, tickets issued, and how", "many are already checked in.", "Filter the guest list by event."], "pay"),
                (6, "Resend a ticket", ["On a paid row, tap WhatsApp or", "Email. Use this if a guest lost the", "message. Pending payments cannot", "be resent."], "ticket"),
            ],
            [("Rejected", ["If the status is Not approved, WhatsApp TANK on +256 775 497 509 and ask what to change. Then edit and submit again."], "red")],
        ),
        (
            "On the night",
            ["Door check-in works on the phone you are signed in with. You can only check in tickets for your own events."],
            [
                (7, "Scan the QR", ["Open Dashboard, then Door.", "Tap Scan QR code and allow the", "camera. Point it at the guest's code.", "A green box means they are in."], "door"),
                (8, "Or type the code", ["If the camera fails, type the code", "under the QR. It looks like", "TNK-XXXXXXXX. A red box means", "unpaid, already used, or wrong event."], "door"),
            ],
            [("Edit carefully", ["You can edit details later from My events. Deleting an event also removes its orders. Do not delete a night that has already sold tickets unless you mean to."], "gold")],
        ),
    ]


def admin_sections():
    return [
        (
            "Sign in to the desk",
            ["There is no Admin button on the public site. Only one email can open this desk."],
            [
                (1, "Open the hidden address", ["Go to tanktickets.site/#/admin.", "Bookmark it. The front page will", "not show this link."], "search"),
                (2, "Use the admin email", ["Sign in as admin@tanktickets.site.", "No other account becomes admin,", "even if it was created first. The", "email must be confirmed."], "pay"),
            ],
            [("If you see your own dashboard instead", ["You are signed in as someone else. Sign out, then sign in again with admin@tanktickets.site."], "red")],
        ),
        (
            "Review and run events",
            ["Organizer events arrive as In review. Events you create yourself go Live immediately."],
            [
                (3, "Approve or reject", ["Open Review. Read the poster,", "price, date and description.", "Approve to put it on sale. Reject", "if details are wrong or unsafe."], "review"),
                (4, "Talk to the host", ["Tap WhatsApp organizer before", "you reject, so they know what to", "fix. They can edit and you can", "approve the same event later."], "review"),
                (5, "Change any event", ["Events lists every night. Set Live,", "In review, or Not approved.", "Open, edit, or delete. Delete also", "removes that event's orders."], "form"),
            ],
            [("List a TANK event", ["List a TANK event skips the queue and publishes at once. Use it only for nights TANK is running."], "green")],
        ),
        (
            "Tickets, door, and settings",
            ["Orders shows every sale. Door can check in any event, not only TANK's own nights."],
            [
                (6, "Resend from Orders", ["Find the guest. After payment,", "tap WhatsApp or Email. Pending", "means they have not approved", "the PIN yet."], "ticket"),
                (7, "Work any door", ["Door scans every TANK ticket.", "Green means welcome. Red means", "already in, not paid, or a bad code."], "door"),
                (8, "Turn on email tickets", ["Ticket delivery: add EmailJS", "Service ID, Template ID and Public", "Key, allow tanktickets.site, then", "Save email settings."], "form"),
            ],
            [
                ("Keep payments in test mode", ["The Payments tab can store a ZengaPay token, but that token would be visible in buyers' browsers. Leave Test mode on until a server holds the token. Never paste a live token here."], "red"),
                ("Database must be connected", ["If the desk says Database not connected, events exist only on that phone. Connect Supabase before real sales. The steps are in SETUP.md."], "gold"),
            ],
        ),
    ]


def main():
    jobs = [
        ("manuals/TANK-Tickets-Buyer-Guide.pdf", BUYER, buyer_sections()),
        ("manuals/TANK-Tickets-Organizer-Guide.pdf", ORGANIZER, organizer_sections()),
        ("manuals/TANK-Tickets-Admin-Guide.pdf", ADMIN, admin_sections()),
    ]
    for path, meta, sections in jobs:
        make_doc(path, meta, story_for(meta, sections))
        print("wrote", path)


if __name__ == "__main__":
    main()
