export interface PaymentStatusCardProps { paymentId: string; amount: number; status: 'paid' | 'pending' | 'failed' }
export function PaymentStatusCard({ paymentId, amount, status }: PaymentStatusCardProps) {
  return <div>{paymentId} {amount} {status}</div>;
}
