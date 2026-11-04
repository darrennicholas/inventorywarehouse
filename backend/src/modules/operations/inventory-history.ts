/** Reconstruct a page of signed movements, ordered newest first, from today's balance. */
export function reconstructStockBalances(current: number, newerMovementTotal: number, quantities: number[]) {
  let running = current - newerMovementTotal;
  return quantities.map((quantity) => {
    const after = running;
    const before = after - quantity;
    running = before;
    return { before, after };
  });
}
