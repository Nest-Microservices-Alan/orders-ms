import { HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { Prisma, PrismaClient } from '@prisma/client';
import { RpcException } from '@nestjs/microservices';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { OrderPaginationDto } from './dto/order-pagination.dto';
import { changeOrderStatusDto } from './dto/change-order-status.dto';

@Injectable()
export class OrdersService extends PrismaClient implements OnModuleInit {

  private readonly logger = new Logger('OrdersService')

  async onModuleInit() {
    await this.$connect()
    this.logger.log('Database connected')
  }

  create(createOrderDto: CreateOrderDto) {
    return this.order.create({
      data: createOrderDto
    })
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