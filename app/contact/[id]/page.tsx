import ContactPage from '@/app/components/ContactPage'

export default function ContactRoute({ params }: { params: { id: string } }) {
  return <ContactPage contactId={params.id} />
}