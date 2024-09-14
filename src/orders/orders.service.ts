import { HttpStatus, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { Prisma, PrismaClient } from '@prisma/client';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { OrderPaginationDto } from './dto/order-pagination.dto';
import { changeOrderStatusDto } from './dto/change-order-status.dto';
import { PRODUCT_SERVICE } from 'src/config/services';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class OrdersService extends PrismaClient implements OnModuleInit {

  private readonly logger = new Logger('OrdersService')

  constructor(
    @Inject(PRODUCT_SERVICE) private readonly productsClient: ClientProxy
  ) {
    super()
  }

  async onModuleInit() {
    await this.$connect()
    this.logger.log('Database connected')
  }

  async create(createOrderDto: CreateOrderDto) {

    const ids = [57, 60]

    const products = await firstValueFrom(
      this.productsClient.send({ cmd: 'validate_products' }, ids)
    )


    return products;
    
  }

  async findAll(orderPaginationDto: OrderPaginationDto) {
    const { page, limit, status } = orderPaginationDto

    const totalItems = await this.order.count({
      where: {
        status: status
      }
    });
    const lastPage = Math.ceil(totalItems / limit);


    return {
      data: await this.order.findMany({
        skip: (page - 1) * limit,
        take: limit,
        where: {
          status: status
        }
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
      where: { id: id }
    })

    if (!order) {
      throw new RpcException({
        message:`Product with id #${id} not found`,
        status: HttpStatus.NOT_FOUND 
      })
    }

    return order;
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
