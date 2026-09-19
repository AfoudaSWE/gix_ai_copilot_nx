export interface Application {
  readonly id: string;
  readonly applicantName: string;
  readonly status: 'pending' | 'approved' | 'rejected';
}

export const APPLICATIONS: readonly Application[] = [
  { id: 'APP-1024', applicantName: 'Priya Shah', status: 'pending' },
  { id: 'APP-2048', applicantName: 'Marco Bellini', status: 'approved' },
  { id: 'APP-3072', applicantName: 'Wei Zhang', status: 'rejected' },
];

export function findApplication(id: string): Application | undefined {
  return APPLICATIONS.find((application) => application.id === id);
}
