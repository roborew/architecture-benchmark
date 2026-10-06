const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

/**
 * Renders an ISO date (YYYY-MM-DD) as "27 Sep 2026".
 *
 * The string is split rather than handed to `new Date`, which parses a
 * bare ISO date as UTC and then renders it in local time. That shifts
 * the day for anyone west of Greenwich, so tests and screens would
 * disagree depending on where they run.
 */
export function formatDate(isoDate: string): string {
	const [year, month, day] = isoDate.split("-").map(Number);

	return `${day} ${MONTHS[month - 1]} ${year}`;
}
