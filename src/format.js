export const formatMoney = (value) => {
  const amount = Number(value) || 0;
  return amount < 0
    ? `-$${Math.abs(amount).toLocaleString()}`
    : `$${amount.toLocaleString()}`;
};
