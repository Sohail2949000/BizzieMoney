export function adjacentMonth(month: string, offset: number): string {
  const [yearPart, monthPart] = month.split('-');
  const date = new Date(
    Date.UTC(Number(yearPart), Number(monthPart) - 1 + offset, 1),
  );
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthDateRange(month: string): {
  dateFrom: string;
  dateTo: string;
} {
  const [yearPart, monthPart] = month.split('-');
  const finalDay = new Date(
    Date.UTC(Number(yearPart), Number(monthPart), 0),
  ).getUTCDate();
  return {
    dateFrom: `${month}-01`,
    dateTo: `${month}-${String(finalDay).padStart(2, '0')}`,
  };
}

export function monthLabel(month: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(new Date(`${month}-01T12:00:00.000Z`));
}
