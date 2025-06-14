// utils/stripeHelpers.js
import { stripe } from '../lib/config.js';
import prisma from '../lib/prismaClient.js';

export async function ensureCustomer(user) {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const c = await stripe.customers.create({ email: user.email, name: user.name });
  await prisma.user.update({ where:{id:user.id}, data:{stripeCustomerId:c.id} });
  return c.id;
}
