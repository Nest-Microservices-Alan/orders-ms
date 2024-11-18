import { HttpStatus, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { Prisma, PrismaClient } from '@prisma/client';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { OrderPaginationDto } from './dto/order-pagination.dto';
import { changeOrderStatusDto } from './dto/change-order-status.dto';
import { NATS_SERVICE } from 'src/config/services';
import { firstValueFrom } from 'rxjs';
import { OrderWithProducts } from './interfaces/order-with-products.interface';
import { PaidOrderDto } from './dto/paid-order.dto';

@Injectable()
export class OrdersService extends PrismaClient implements OnModuleInit {

  private readonly logger = new Logger('OrdersService')

  constructor(
    @Inject(NATS_SERVICE) private readonly client: ClientProxy
  ) {
    super()
  }

  async onModuleInit() {
    await this.$connect()
    this.logger.log('Database connected')
  }

  async create(createOrderDto: CreateOrderDto) {

    try {

      const productIds = createOrderDto.items.map(item => item.productId)
      
      //Validate if exists products in database
      const products : any[] = await firstValueFrom(
        this.client.send({ cmd: 'validate_products' }, productIds)
      )
      
      //Get total amount of the order
      const totalAmount = createOrderDto.items.reduce((acc, orderItem) => {

        const price = products.find(product => product.id === orderItem.productId).price

        return price * orderItem.quantity

      }, 0)

      //Get quantity
      const totalItems = createOrderDto.items.reduce((acc, orderItem) => {

        return acc + orderItem.quantity

      }, 0)

      const order = await this.order.create({
        data: {
          totalAmount: totalAmount,
          totalItems: totalItems,
          OrderItem: {
            createMany: {
              data: createOrderDto.items.map((orderItem) => ({
                price: products.find(product => product.id === orderItem.productId).price,
                productId: orderItem.productId,
                quantity: orderItem.quantity
              }))
            }
          }
        },
        include: {
          OrderItem: {
            select: {
              price: true,
              quantity: true,
              productId: true
            }
          }
        }
      })

      return {
        ...order,
        OrderItem: order.OrderItem.map((orderItem) => ({
          ...orderItem,
          name: products.find(product => product.id === orderItem.productId).name
        }))
      };

    } catch (error) {
      throw new RpcException({
        status: HttpStatus.BAD_REQUEST,
        message: error.message
      })
    }
    
  }

  async findAll(orderPaginationDto: OrderPaginationDto) {
    const { page, limit, status } = orderPaginationDto

    const totalItems = await this.order.count({
      where: {
        status: status
      },
    });

    //Get last page of the pagination
    const lastPage = Math.ceil(totalItems / limit);


    return {
      data: await this.order.findMany({
        skip: (page - 1) * limit,
        take: limit,
        where: {
          status: status
        },
      }),
      meta: {
        page: page,
        totalItems: totalItems,
        lastPage: lastPage
      }
    }
  }

  async findOne(id: string) {
    const order = await this.order.findFirst({
      where: { id: id },
      include: {
        OrderItem: {
          select: {
            price: true,
            quantity: true,
            productId: true
          }
        }
      }
    })

    if (!order) {
      throw new RpcException({
        message:`Product with id #${id} not found`,
        status: HttpStatus.NOT_FOUND 
      })
    }

    const productIds = order.OrderItem.map((orderItem) => orderItem.productId);


    const products : any[] = await firstValueFrom(
      this.client.send({ cmd: 'validate_products' }, productIds)
    )


    return {
      ...order,
      OrderItem: order.OrderItem.map((orderItem) => ({
        ...orderItem,
        name: products.find(product => product.id === orderItem.productId).name
      }))
    };
  }

  async changeStatus(changeOrderStatusDto: changeOrderStatusDto) {

    const { id, status } = changeOrderStatusDto;

    try {
      return this.order.update({
        where: { id: id },
        data: {
          status: status
        }
      }) 
    } catch (e) {
      this.handleErrors(e, id)
    }
    
  }

  async createPaymentSession(order: OrderWithProducts) {

    const paymentSession = await firstValueFrom(
      this.client.send('create.payment.session', {
        orderId: order.id,
        currency: 'usd',
        items: order.OrderItem.map(item => ({
          name: item.name,
          price: item.price,
          quantity: item.quantity
        }))
      })
    )

    return paymentSession;

  }


  async paidOrder(paidOrderDto: PaidOrderDto) {

    const order = this.order.update({
      where: { id: paidOrderDto.orderId },
      data: {
        status: 'PAID',
        paid: true,
        paidAt: new Date(),
        stripeChargeId: paidOrderDto.stripePaymentId,
        //La relacion
        OrderReceipt: {
          create: {
            receiptUrl: paidOrderDto.receiptUrl
          }
        }
      }
    })

    return order;

  }

  private handleErrors(e, id) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2025') {
        throw new RpcException({ message: `Product with id #${id} not found`, status: HttpStatus.NOT_FOUND });
      }
    }
  }

}
