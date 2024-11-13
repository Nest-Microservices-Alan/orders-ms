import { HttpStatus, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { Prisma, PrismaClient } from '@prisma/client';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { OrderPaginationDto } from './dto/order-pagination.dto';
import { changeOrderStatusDto } from './dto/change-order-status.dto';
import { NATS_SERVERS } from 'src/config/services';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class OrdersService extends PrismaClient implements OnModuleInit {

  private readonly logger = new Logger('OrdersService')

  constructor(
    @Inject(NATS_SERVERS) private readonly client: ClientProxy
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
  
      const products : any[] = await firstValueFrom(
        this.client.send({ cmd: 'validate_products' }, productIds)
      )
      
      const totalAmount = createOrderDto.items.reduce((acc, orderItem) => {

        const price = products.find(product => product.id === orderItem.productId).price

        return price * orderItem.quantity

      }, 0)

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

  private handleErrors(e, id) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2025') {
        throw new RpcException({ message: `Product with id #${id} not found`, status: HttpStatus.NOT_FOUND });
      }
    }
  }

}
