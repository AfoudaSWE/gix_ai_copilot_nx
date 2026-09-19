export interface Application {
  readonly id: string;
  readonly applicantName: string;
  readonly status: 'pending' | 'approved' | 'rejected';
  readonly country: string;
}

export const APPLICATIONS: readonly Application[] = [
  { id: 'APP-1001', applicantName: 'Ahmed', status: 'pending', country: 'AE' },
  { id: 'APP-1002', applicantName: 'Sara', status: 'pending', country: 'AE' },
  { id: 'APP-1003', applicantName: 'Omar', status: 'approved', country: 'EG' },
  { id: 'APP-1004', applicantName: 'Lina', status: 'rejected', country: 'SA' },
];

export type StatusFilter = 'all' | Application['status'];

export function filterApplications(
  applications: readonly Application[],
  status: StatusFilter,
): readonly Application[] {
  return status === 'all' ? applications : applications.filter((app) => app.status === status);
}
