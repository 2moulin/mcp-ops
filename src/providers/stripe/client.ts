import Stripe from 'stripe';

// The slice of Stripe the tools touch. All reads.
export interface StripeReader {
  accounts: {
    list(params: Stripe.AccountListParams): Promise<Stripe.ApiList<Stripe.Account>>;
    retrieve(id: string): Promise<Stripe.Account>;
  };
  balance: {
    retrieve(params?: Stripe.BalanceRetrieveParams, options?: Stripe.RequestOptions): Promise<Stripe.Balance>;
  };
  transfers: {
    list(params: Stripe.TransferListParams): Promise<Stripe.ApiList<Stripe.Transfer>>;
    retrieve(id: string, params?: Stripe.TransferRetrieveParams): Promise<Stripe.Transfer>;
  };
  charges: {
    list(params: Stripe.ChargeListParams, options?: Stripe.RequestOptions): Promise<Stripe.ApiList<Stripe.Charge>>;
    retrieve(id: string, params?: Stripe.ChargeRetrieveParams, options?: Stripe.RequestOptions): Promise<Stripe.Charge>;
  };
  payouts: {
    list(params: Stripe.PayoutListParams, options?: Stripe.RequestOptions): Promise<Stripe.ApiList<Stripe.Payout>>;
  };
  webhookEndpoints: {
    list(params: Stripe.WebhookEndpointListParams): Promise<Stripe.ApiList<Stripe.WebhookEndpoint>>;
  };
  events: {
    list(params: Stripe.EventListParams): Promise<Stripe.ApiList<Stripe.Event>>;
    retrieve(id: string): Promise<Stripe.Event>;
  };
}

export function createStripe(secretKey: string): StripeReader {
  return new Stripe(secretKey, {
    appInfo: { name: 'mcp-ops', url: 'https://github.com/2moulin/mcp-ops' },
  }) as unknown as StripeReader;
}

export function keyMode(secretKey: string): 'live' | 'test' | 'unknown' {
  if (/^(sk|rk)_live_/.test(secretKey)) return 'live';
  if (/^(sk|rk)_test_/.test(secretKey)) return 'test';
  return 'unknown';
}
