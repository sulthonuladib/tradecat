import { describe, expect, test } from 'bun:test';
import { gateInfoFrom, mexcInfoFrom } from '../src/lib/coininfo';

const gateChains = [
  {
    chain: 'BTC',
    name_en: 'Bitcoin',
    is_disabled: 0,
    is_deposit_disabled: 0,
    is_withdraw_disabled: 0,
    withdraw_amount_min: '0.0005',
  },
  {
    chain: 'BSC',
    name_en: 'BNB Smart Chain(BEP20)',
    is_disabled: 0,
    is_deposit_disabled: 0,
    is_withdraw_disabled: 1,
    withdraw_amount_min: '0.0005',
  },
  {
    chain: 'OLD',
    name_en: 'Retired chain',
    is_disabled: 1,
    is_deposit_disabled: 0,
    is_withdraw_disabled: 0,
    withdraw_amount_min: '1',
  },
];

describe('gateInfoFrom', () => {
  const feeBody = {
    datas: {
      rate_usdt: '77000',
      chains: [
        { chain: 'BTC', withdraw_txfee: '0.0005' },
        { chain: 'TRX', withdraw_txfee: '1' },
      ],
    },
  };

  test('merges public chain status with session fees', () => {
    const info = gateInfoFrom(gateChains, feeBody, 'BTC');
    expect(info.needsLogin).toBe(false);
    expect(info.priceUsdt).toBe(77000);
    expect(info.chains.map((chain) => chain.name)).toEqual(['BTC', 'BSC', 'OLD', 'TRX']);

    const btc = info.chains.find((chain) => chain.name === 'BTC');
    expect(btc).toMatchObject({ deposit: true, withdraw: true, fee: 0.0005, minWithdraw: 0.0005 });

    const bsc = info.chains.find((chain) => chain.name === 'BSC');
    expect(bsc).toMatchObject({ deposit: true, withdraw: false, fee: null });

    // A retired chain is closed for both directions.
    const old = info.chains.find((chain) => chain.name === 'OLD');
    expect(old).toMatchObject({ deposit: false, withdraw: false });

    // Fee-only chains are still listed.
    expect(info.chains.find((chain) => chain.name === 'TRX')?.fee).toBe(1);
  });

  test('handles a fee payload that requires a login', () => {
    const info = gateInfoFrom(gateChains, { resMsg: { code: 1000, message: 'Please login first' }, datas: [] }, 'BTC');
    expect(info.needsLogin).toBe(true);
    expect(info.priceUsdt).toBeNull();
    expect(info.chains).toHaveLength(3);
    expect(info.chains.every((chain) => chain.fee === null)).toBe(true);
    expect(info.deposit).toBe(true);
    expect(info.withdraw).toBe(true);
  });

  test('keeps working when the fee request failed entirely', () => {
    const info = gateInfoFrom(gateChains, null, 'BTC');
    expect(info.needsLogin).toBe(false);
    expect(info.chains).toHaveLength(3);
    expect(info.chains[0]?.minWithdraw).toBe(0.0005);
  });
});

describe('mexcInfoFrom', () => {
  const body = {
    code: 0,
    data: {
      currencyPrice: '77000',
      chains: [
        {
          chainName: 'BTC',
          enableDeposit: true,
          enableWithdraw: true,
          withdrawFee: '0.0005',
          withdrawMin: '0.001',
          withdrawMax: '10',
        },
        {
          chainName: 'BSC',
          enableDeposit: true,
          enableWithdraw: false,
          withdrawFee: '0.0001',
          withdrawMin: '0.0005',
        },
      ],
    },
  };

  test('reads chainName / enableWithdraw / withdrawFee / currencyPrice', () => {
    const info = mexcInfoFrom(body, 'BTC');
    expect(info.needsLogin).toBe(false);
    expect(info.priceUsdt).toBe(77000);
    expect(info.deposit).toBe(true);
    expect(info.withdraw).toBe(true);
    expect(info.chains).toEqual([
      {
        name: 'BTC',
        deposit: true,
        withdraw: true,
        depositDelayed: false,
        withdrawDelayed: false,
        fee: 0.0005,
        feePercent: null,
        minWithdraw: 0.001,
        maxWithdraw: 10,
      },
      {
        name: 'BSC',
        deposit: true,
        withdraw: false,
        depositDelayed: false,
        withdrawDelayed: false,
        fee: 0.0001,
        feePercent: null,
        minWithdraw: 0.0005,
        maxWithdraw: null,
      },
    ]);
  });

  test('accepts a map of chains and snake_case aliases', () => {
    const info = mexcInfoFrom(
      {
        code: 0,
        data: {
          currency_price: '2.5',
          chains: {
            a: { network: 'eth', deposit_enable: 1, withdraw_enable: 0, withdraw_fee: '0.4' },
          },
        },
      },
      'XYZ',
    );
    expect(info.priceUsdt).toBe(2.5);
    expect(info.chains).toHaveLength(1);
    expect(info.chains[0]).toMatchObject({ name: 'ETH', deposit: true, withdraw: false, fee: 0.4 });
  });

  test('reports a login requirement instead of throwing', () => {
    const info = mexcInfoFrom({ code: 401, msg: 'User not log in.' }, 'BTC');
    expect(info.needsLogin).toBe(true);
    expect(info.chains).toEqual([]);
  });
});
