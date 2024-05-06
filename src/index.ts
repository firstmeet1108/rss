import { Context, Schema } from 'koishi';
import { commandGeneratorMap, cronTaskGeneratorMap } from './ganeraterMap';
import { xml2js } from 'xml-js';

export const name = 'rss';
declare module 'koishi' {
  interface Tables {
    cron_task: CronTask;
  }
}

interface CronTask {
  id: number;
  name: string;
  target_id: number;
  create_time: Date;
}

export interface TaskHandlerMap {
  epic: (userContext: UserContext, ctx: Context) => any;
  // steam: () => void;
  // github: () => void;
}

const taskHandlerMap: TaskHandlerMap = {
  epic: async ({}, ctx) => {
    const toRenderData = await getRssData(
      'https://rsshub.app/epicgames/freegames/zh-CN',
      ctx
    );
    const toSendData = cronTaskGeneratorMap['epic'](toRenderData);

    return toRenderData;
  },
  // steam: () => {
  //   console.log('STEAM');
  // },
  // github: () => {
  //   console.log('GITHUB');
  // },
};

type UserContext = {
  target_id: number;
  task_name: keyof TaskHandlerMap;
  option: keyof CommandOptionsHandlerMap;
};

interface CommandOptionsHandlerMap {
  subscribe: (
    userContext: UserContext,
    ctx: Context
  ) => Promise<{ type: 'subscribe'; data: null }>;
  list: (
    userContext: UserContext,
    ctx: Context
  ) => Promise<{ type: 'list'; data: (keyof TaskHandlerMap)[] }>;
  all: () => Promise<{ type: 'all'; data: (keyof TaskHandlerMap)[] }>;
}

const commandOptionsHandlerMap: CommandOptionsHandlerMap = {
  subscribe: async ({ target_id, task_name }, ctx) => {
    // 订阅
    const res = await ctx.database.create('cron_task', {
      name: task_name,
      target_id,
      create_time: new Date(),
    });
    return {
      type: 'subscribe',
      data: null,
    };
  },
  list: async ({ target_id }, ctx) => {
    // 用户订阅的内容列表
    const tasks = await ctx.database
      .select('cron_task', {
        target_id,
      })
      .groupBy('name')
      .execute();
    return {
      type: 'list',
      data: tasks.map((task) => task.name) as (keyof TaskHandlerMap)[] | null,
    };
  },
  all: async () => {
    // 所有可订阅的内容列表
    return { type: 'all', data: getKeys(taskHandlerMap) };
  },
};

export interface Config {}

export const Config: Schema<Config> = Schema.object({});

export async function apply(ctx: Context) {
  // 创建数据库
  ctx.model.extend(
    'cron_task',
    {
      id: 'unsigned',
      name: 'string',
      target_id: 'integer',
      create_time: 'timestamp',
    },
    {
      autoInc: true,
      unique: [['name', 'target_id']],
    }
  );
  // 命令模块
  ctx
    .command('subscribe <task_name:string>', '定时任务管理')
    .option('list', '-l') // 任务列表
    .option('all', '-a') // 所有任务
    .alias('sub')
    .action(async ({ options, session }, task_name) => {
      // 错误校验
      try {
        if (isEmptyObject(options) && task_name === undefined) {
          // 未输入 任务名 和 选项
          throw new Error('请输入订阅内容');
        } else if (
          isEmptyObject(options) &&
          !Object.keys(taskHandlerMap).includes(task_name)
        ) {
          // 选项为空 且 任务名不在任务列表中
          throw new Error('未知任务名, 使用 sub -a 查看所有任务');
        } else if (Object.keys(options).length > 1) {
          // 输入多个选项
          throw new Error('请勿输入多个选项');
        } else if (!isEmptyObject(options) && task_name !== undefined) {
          // 同时输入了任务名和选项
          throw new Error('请勿同时输入任务名和选项');
        } else if (
          // 未知选项
          !isEmptyObject(options) &&
          commandOptionsHandlerMap[Object.keys(options)[0]] === undefined
        ) {
          throw new Error('未知选项, 使用 sub -h 查看帮助');
        }
      } catch (e) {
        session.send(e.message);
        return;
      }

      // 获取必要数据
      const messageData = session.event._data;
      const target_id: number & Context =
        messageData.message_type === 'group'
          ? messageData.group_id
          : messageData.user_id;

      const option: keyof CommandOptionsHandlerMap = (
        Object.keys(options).length === 1
          ? Object.keys(options)[0]
          : 'subscribe'
      ) as keyof CommandOptionsHandlerMap;

      // 当前可用数据
      const userContext: UserContext = {
        target_id, // 群号或者用户号
        task_name: task_name as keyof TaskHandlerMap, // 任务名
        option, // 选项
      };
      // 希望得到 待渲染数据data
      const toRenderData = await commandOptionsHandlerMap[option](
        userContext,
        ctx
      );
      const toSendData = commandGeneratorMap[option](toRenderData.data);
      session.send(toSendData);
    });
  ctx
    .command('test', 'test', {
      authority: 2,
    })
    .action(async ({ session }) => {
      console.log('test');
      const onebot = ctx.bots[0];
      await onebot.sendPrivateMessage('2022742378', 'test');
      // for (const task_name in taskHandlerMap) {
      //   console.log(task_name);
      //   const target_id_arr = await ctx.database.get(
      //     'cron_task',
      //     {
      //       name: task_name,
      //     },
      //     ['target_id']
      //   );
      //   target_id_arr
      //     .map((e) => e.target_id.toString())
      //     .forEach(async (e) => {
      //       console.log(e);
      //       await onebot.sendMessage(e, 'epic');
      //     });
      // }
    });
  // 定时任务模块
}
// 任务动作
// toRenderData = await taskHandlerMap[task_name](userContext, ctx);
// const toSendData = generateContent(toRenderData);
// session.send(toSendData);

// 获得 数据对象result

// const massages = ganerateMsg(result);
// session.send(massages);

const isEmptyObject = (obj: object): boolean => {
  return Object.keys(obj).length === 0;
};

const getKeys = <T extends object>(obj: T): (keyof T)[] => {
  return Object.keys(obj) as (keyof T)[];
};

const getRssData = async (url: string, ctx: Context) => {
  const data = await ctx.http.get(url);
  const decoder = new TextDecoder('utf-8');
  const result = (xml2js(decoder.decode(data), { compact: true }) as any).rss
    .channel;
  return result;
};
