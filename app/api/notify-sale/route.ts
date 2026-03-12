import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(req: NextRequest) {
  try {
    const { contact_name, estimate, environment, sale_date, user_email } = await req.json()

    const { error } = await resend.emails.send({
      from: 'CRM Pensarecasa <onboarding@resend.dev>',
      to: ['nicola@timbro.agency'], // ← cambia con la tua email
      subject: `🏆 Nuova vendita: ${contact_name}`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; background: #f9fafb; border-radius: 12px;">
          <h2 style="color: #16a34a; margin-bottom: 4px;">🏆 Nuova vendita!</h2>
          <p style="color: #6b7280; margin-top: 0;">Un contatto è stato aggiudicato su CRM Pensarecasa C.so Regina</p>
          <div style="background: white; border-radius: 8px; padding: 16px; margin: 16px 0; border: 1px solid #e5e7eb;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr><td style="padding: 6px 0; color: #6b7280; font-size: 13px;">Cliente</td><td style="padding: 6px 0; font-weight: 600; color: #111827;">${contact_name}</td></tr>
              ${estimate ? `<tr><td style="padding: 6px 0; color: #6b7280; font-size: 13px;">Valore</td><td style="padding: 6px 0; font-weight: 600; color: #16a34a;">€ ${Number(estimate).toLocaleString('it-IT')}</td></tr>` : ''}
              ${environment ? `<tr><td style="padding: 6px 0; color: #6b7280; font-size: 13px;">Ambiente</td><td style="padding: 6px 0; color: #111827;">${environment}</td></tr>` : ''}
              ${sale_date ? `<tr><td style="padding: 6px 0; color: #6b7280; font-size: 13px;">Data vendita</td><td style="padding: 6px 0; color: #111827;">${new Date(sale_date).toLocaleDateString('it-IT')}</td></tr>` : ''}
              ${user_email ? `<tr><td style="padding: 6px 0; color: #6b7280; font-size: 13px;">Registrato da</td><td style="padding: 6px 0; color: #111827;">${user_email}</td></tr>` : ''}
            </table>
          </div>
          <p style="color: #9ca3af; font-size: 12px; text-align: center; margin-top: 16px;">Pensarecasa C.so Regina · CRM</p>
        </div>
      `,
    })

    if (error) return NextResponse.json({ error }, { status: 400 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}