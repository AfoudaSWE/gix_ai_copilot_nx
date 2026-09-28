import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Module,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { createUserSchema, parseInput, updateUserSchema, UsersService } from './users.js';
import type { User } from './users.js';

@Controller('api/users')
class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Get()
  list(): Promise<User[]> {
    return this.users.list();
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<User> {
    return this.users.get(id);
  }

  @Post()
  create(@Body() body: unknown): Promise<User> {
    return this.users.create(parseInput(createUserSchema, body));
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown): Promise<User> {
    return this.users.update(id, parseInput(updateUserSchema, body));
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string): Promise<void> {
    return this.users.remove(id);
  }
}

@Module({ controllers: [UsersController], providers: [UsersService] })
export class AppModule {}
