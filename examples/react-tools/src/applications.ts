export interface Application {
  readonly id: string;
  readonly applicantName: string;
  readonly status: string;
}

export const APPLICATIONS: readonly Application[] = [
  { id: 'APP-1024', applicantName: 'Priya Shah', status: 'PENDING' },
  { id: 'APP-2048', applicantName: 'Marco Bellini', status: 'APPROVED' },
  { id: 'APP-3072', applicantName: 'Wei Zhang', status: 'REJECTED' },
];

export function findApplication(id: string): Application | undefined {
  return APPLICATIONS.find((app) => app.id === id);
}
