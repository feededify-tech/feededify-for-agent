// Wait for a specified number of seconds.
// An agent uses this to poll MCP status portably: shell sleep is not available or blocked everywhere.
// Usage: node wait-run.mjs <seconds>
// <seconds>: integer 1..300. Waits that many seconds using setTimeout, prints "waited N s", exits 0.
// Error: missing, 0, negative, non-integer, or >300 prints usage to stderr and exits 2.

const usage = () => {
  console.error('Usage: node wait-run.mjs <seconds>');
  console.error('<seconds> must be an integer from 1 to 300');
  process.exit(2);
};

const args = process.argv.slice(2);
if (args.length === 0) usage();

const input = args[0];
const seconds = Number.parseInt(input, 10);

if (
  Number.isNaN(seconds) ||
  seconds !== Number.parseFloat(input) ||
  seconds < 1 ||
  seconds > 300
) {
  usage();
}

await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
console.log(`waited ${seconds} s`);
