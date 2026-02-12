import chalk from 'chalk';
import Table from 'cli-table3';

interface TableOptions {
  head: string[];
  rows: (string | number)[][];
  totalRow?: (string | number)[];
}

export function printTable({ head, rows, totalRow }: TableOptions): void {
  const table = new Table({
    head: head.map((h) => chalk.bold(h)),
    style: { head: [], border: [] },
  });

  for (const row of rows) {
    table.push(row.map((cell) => String(cell)));
  }

  if (totalRow) {
    table.push(totalRow.map((cell) => chalk.bold(String(cell))));
  }

  console.log(table.toString());
}
