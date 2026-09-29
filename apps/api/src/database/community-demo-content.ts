import type { CommunityTopic } from "@xuetu/contracts";

import {
  PRE_DEFENSE_STUDENTS,
  PRE_DEFENSE_TARGET_SCHOOLS,
} from "./pre-defense-demo-roster.js";

interface CommunityDemoPost {
  postId: string;
  circleId: string;
  authorUserId: string;
  topic: CommunityTopic;
  title: string;
  body: string;
  ageHours: number;
  viewCount: number;
}

interface CommunityDemoReply {
  replyId: string;
  postId: string;
  authorUserId: string;
  body: string;
  ageHours: number;
}

interface CommunityDemoLike {
  postId: string;
  userId: string;
}

interface CommunityConversationTemplate {
  title: string;
  body: string;
  replies: readonly string[];
}

const topicContent = {
  择校交流: [
    {
      title: "择校信息看了一晚上，更乱了",
      body: "昨晚收藏了十几篇经验贴，今天一翻发现每个人说的都不一样。我现在只确定考 408，城市和学校档次还在打架。先停两天去学专业课了，不然光择校就能把一天耗完。",
      replies: [
        "我也是，先把完全不想去的城市删了。",
        "我之前列了快二十所，越列越离谱。后来只留三个条件：考 408、招生人数别太少、复试形式能接受，名单一下就短了。",
        "先别刷经验贴了，越刷越慌。",
      ],
    },
    {
      title: "有没有一起盯{school}官网的？",
      body: "我把{school}先放进收藏夹了，现在找到招生目录和复试名单，别的还没捋明白。官网吗页面又多，我每次点进去都要重新找。有没有同目标的，后面出通知互相喊一声。",
      replies: [
        "同目标，我直接把学院通知页放浏览器第一格了。",
        "目录、复试细则、拟录取名单这几个先存好。群里的截图我现在都只当线索，最后还是回官网对一下，旧年份的消息太容易串。",
      ],
    },
    {
      title: "想冲{school}，但我这进度配吗？",
      body: "ds 刚过树，计组到存储器，另外两门还没开。嘴上说想冲{school}，看到别人已经一轮结束又有点怂。先按这个目标学到暑假末再测一次，还是现在就该降档？",
      replies: [
        "那你已经比我快了，我计组还没开。",
        "现在直接做整套分数也不太准，你还有两门没学。先定个复盘时间吧，到时候拿没做过的题测，不行再换也不迟。",
        "冲归冲，最好再留一所考试科目一样的，后面真调整不会从头来。",
        "我也卡这，先蹲个答案。",
      ],
    },
    {
      title: "{school}放冲刺档会不会太敢想了？",
      body: "科班但本科课学得一般，408 现在只过了两门，数学也没到能测分的程度。室友听到{school}第一句就是“你挺敢想”，给我说得有点没底了。",
      replies: [
        "室友又不替你考，先学你的。",
        "我不太建议现在凭一句话降目标。你至少把一轮过完，再拿真题和招生人数一起看，不然现在换哪个都像在猜。",
        "不过也别只看学校名，复试内容能不能接受也早点扫一眼。",
      ],
    },
    {
      title: "有一起看{school}的吗？我卡在择校这步了",
      body: "学校名单来回改了三版，{school}一直没删，但也说不出自己到底看中哪一点。可能是城市能接受，也可能只是刷经验贴刷熟了。有同目标的说说你们怎么定下来的。",
      replies: [
        "我主要是专业课科目合适，城市也能接受，没啥特别浪漫的理由。",
        "先想清楚你最不能接受什么，比硬找一个‘非它不可’的理由容易。",
      ],
    },
    {
      title: "准备报{school}，我还漏了啥？",
      body: "目前存了招生目录、复试名单和拟录取名单，专业课确认是 408。复试怎么考我只扫了一眼，还没认真看。怕自己查得太粗，报名的时候突然冒出个接受不了的点。",
      replies: [
        "看看学制学费、校区、复试科目，还有名单里统考到底录了多少。",
        "我还会把近两年的通知日期记一下，不是为了现在焦虑，是后面知道该去哪里等消息。经验贴里没标年份的先别全信。",
        "再查下你报的具体学院，别只看学校总帖。",
      ],
    },
    {
      title: "{school}和另一所来回横跳，408都没学多少",
      body: "这周改了三次目标，早上觉得应该冲，晚上又觉得保命要紧。最离谱的是两所都考 408，我本来完全可以先学，结果时间全拿去翻帖子了。先把择校软件关一周。",
      replies: [
        "会，我已经改四次了。",
        "两所科目一样就先学呗。你现在多看十篇也不会突然得到标准答案，等一轮进度和真题分出来再选，信息反而更多。",
        "给自己定个下次看学校的日期，中间别搜。我就是这样才停下来的。",
      ],
    },
    {
      title: "现在把{school}当暂定目标，早吗？",
      body: "刚准备一个多月，真题也没完整做过。身边人问目标我就先说{school}，说多了自己反而开始怕后面达不到。暂定目标中途改，应该不算临阵脱逃吧。",
      replies: [
        "暂定两个字就是给你改的，别自己加戏。",
        "先有个方向挺好，但别天天拿学校名字压自己。到你设的复盘点再看一次，平时就按当天任务走。",
      ],
    },
    {
      title: "看完一堆{school}经验贴，我更不会选了",
      body: "一篇说别来，一篇说性价比高，还有人只晒分不说基础。看完除了焦虑啥也没留下。我准备只留带年份、带初试分和复习过程的，纯结论先划走。",
      replies: [
        "对，最怕一句‘不难，认真学就行’，等于啥也没说。",
        "我会看发帖人本科基础、开始时间和每天大概学多久。只看最后分数很容易把别人的起点当自己的起点。",
        "再留意是不是同学院同方向，学校名字一样也可能不是一回事。",
      ],
    },
  ],
  备考规划: [
    {
      title: "报个进度，四门摊开以后人麻了",
      body: "ds 到图，co 刚进存储器，os 和计网还躺着。每天打开书先纠结学哪门，半小时就没了。今天先不做完美计划了，计组看一节再说。",
      replies: [
        "我跟你差不多，先蹲一下。",
        "我去年就是每天把四门都切成半小时，最后哪门都没进入状态。后来一天主攻两门，另外两门各做几道题保手感，舒服多了。",
        "计网别一直往后扔，我的计网就是这么消失的。",
        "先把今天那一节看了，计划晚上再改。",
      ],
    },
    {
      title: "每天三小时，硬分四门靠谱吗？",
      body: "白天课不少，晚上稳定能拿出来的就三小时。试过一门四十分钟，刚看进去闹钟就响了，切来切去比学习还累。打算一天两门轮着来。",
      replies: [
        "一天两门可以，我就是这么排的。",
        "三小时别塞满，至少留二十分钟收尾。前面卡一道题，后面全顺延，连续两天就很容易直接不看计划了。",
        "我会一门学新课，一门只复习旧的，不然两门都开新内容脑子有点炸。",
      ],
    },
    {
      title: "周计划第三天就烂尾了",
      body: "周日排计划的时候感觉自己能学十小时，周三一看已经欠六个任务。以前我会熬夜补，结果第二天更烂。准备把每天最后一格直接留空，看能不能活过周五。",
      replies: [
        "别补全，挑一个最影响后面的。",
        "我现在周计划只写必须做的，想做的另外放一栏。哪天状态好再加，不然每天都在给前一天擦屁股。",
      ],
    },
    {
      title: "晚上看计组真的会睡着",
      body: "连着三天晚上看 CPU 都在点头，第二天回放又像没见过。早上倒是清醒，但我八点有课，根本挤不出完整时间。想把新课挪周末，工作日晚上只做题。",
      replies: [
        "同款，晚上看计组必困。",
        "可以试试，做题至少手在动。我晚上看视频十分钟就飘，换成对着一道 Cache 题画地址反而能撑住。",
        "别为了学计组硬改成五点起，我试过，下午直接废。",
      ],
    },
    {
      title: "ds刷上头了，计网还在第一章",
      body: "数据结构题越做越顺，最近每天都先开 ds，结果计网书签一个星期没动。现在让我整天切计网又有点抗拒，感觉会把刚有的手感丢了。",
      replies: [
        "ds 每天留五道，剩下先救计网。",
        "我之前也是这样，喜欢的课越学越多，不喜欢的一直零进度。后来把落后那门固定成第一段，做完才准碰 ds，五六天就没那么抗拒了。",
        "手感没那么容易丢，真丢了两天也能捡回来。",
        "计网第一遍其实挺快，先开起来再说。",
      ],
    },
    {
      title: "一轮还差两门，真来得及吗？",
      body: "计组刚一半，os 才开，群里已经有人发二轮错题了。昨天急着赶了四节视频，今天做题一问三不知，感觉纯给进度条打工。",
      replies: [
        "别看群进度，真的会乱。",
        "你昨天那个速度已经证明不适合你了。少赶一节，留时间做题，至少知道自己有没有看进去。进度条走完不等于一轮走完。",
        "我 os 也刚开，有同进度的。",
      ],
    },
    {
      title: "一道题卡40分钟，后面全崩",
      body: "本来给 ds 留一小时，结果一道图的题卡了四十分钟，计组直接没开。看答案又觉得自己再想五分钟就能出来，每次都舍不得停，最后天天超时。",
      replies: [
        "我设二十五分钟，到点拍照留着晚上再想。",
        "看你当天目标。专门练难题的日子可以死磕，赶一轮的时候就别让一题吃掉两门课，不然计划永远排不准。",
      ],
    },
    {
      title: "周末补新课还是清错题？",
      body: "工作日欠了计组一章，错题也攒了二十多道。周六上午来回切，两个小时过去两边都只动了一点。下周想干脆上午只清错题，下午再追新课。",
      replies: [
        "我支持分半天，别一小时切一次。",
        "二十多道也不用全抄全做，先挑重复错和完全没思路的。粗心一次那种看一眼就走，不然清错题能清到周日晚上。",
        "我反过来，周六追课，周日晚上复盘。主要看你哪段更清醒。",
      ],
    },
    {
      title: "操作系统背完两天就忘，正常吗？",
      body: "前天还觉得进程调度背熟了，今天一做选择题又把周转时间算乱。要是每章都从头背，我这辈子出不了第一轮。现在准备第二天只做题，不重新抄笔记。",
      replies: [
        "正常，第一轮都这样。",
        "做题比从第一页重背有用。题里卡住哪个词就回去补哪个，整章重来很容易获得一种‘今天背了很多’的假进度。",
        "我隔一天做几道，再隔一周重做错的，还是会忘，但没第一次那么夸张。",
        "别要求自己原句复述，能做题就行。",
      ],
    },
  ],
  课程讨论: [
    {
      title: "循环队列又把我绕进去了",
      body: "front 指队头还是队头前一个位置，我每换一道题就忘一次。最气的是对答案时公式都认识，自己做又直接套错。以后第一行先抄题目约定，不背默认。",
      replies: [
        "对，先看约定，不然背得越熟错得越快。",
        "我草稿上只画四个格子，手动入队出队一次。能走通以后再写判空判满，比上来默公式稳。",
        "还有那个牺牲一个单元，别跟计数器方案串了。",
      ],
    },
    {
      title: "TCP拥塞窗口：会了，又没完全会，咋记？",
      body: "慢开始单独问会，拥塞避免也会，一把超时和三个重复 ACK 放一起就乱。刚才甚至把门限和窗口写反了，折线画得像心电图。",
      replies: [
        "先圈事件，别急着算窗口。",
        "我每次固定写两行：新门限是多少、新窗口从哪开始。超时和快重传分开写，最后才画折线，不然一上图就少一轮。",
        "还要看题目按哪版规则，别拿一道解析套所有年份。",
        "心电图笑死，我的也一样。",
      ],
    },
    {
      title: "PV题换个皮就不会了，服了",
      body: "生产者消费者能默出来，换成过桥我连信号量设几个都拿不准。看来之前背的是模板，不是逻辑。今晚先不写 P/V，试着把谁等谁用人话写出来。",
      replies: [
        "先写限制条件，这招有用。",
        "我会把每个进程最坏的执行顺序跑一遍，看它会卡在哪。能说清谁应该睡、谁来叫醒，再翻成 P/V 就没那么玄学。",
        "读者写者我也还不会，蹲。",
      ],
    },
    {
      title: "Cache地址题一多单位我就寄",
      body: "标记、组号、块内地址都会分，题目一加字节编址和多少字一块，我的 2 次方就开始乱飞。今天又差了两位，最后发现把字当字节了。",
      replies: [
        "第一行先写单位，真的能救命。",
        "我会把地址总位数、块大小、每字节几位并排写，后面每算一个数都带单位。麻烦十秒，少返工十分钟。",
      ],
    },
    {
      title: "关键路径倒着算总漏边，咋整？",
      body: "正着推 ve 没事，一到 vl 我就会漏一个后继。图稍微大点，原图上全是数字，自己写的自己都看不懂。是不是该单独画表。",
      replies: [
        "分两张表，别全写图上。",
        "我之前老漏是因为只顺着一条边倒推。现在每个点先数有几个后继，算完打勾，笨一点但不丢。",
      ],
    },
    {
      title: "TLB、缺页、页表一锅炖，救一下",
      body: "每个词单独问都认识，放一道地址转换题里我就不知道这一步到底在查什么。刚才算完得到个虚拟地址，题目明明问物理地址，自己都看笑了。",
      replies: [
        "先拆虚拟地址，再谈后面。",
        "我画三个框：拆地址、查页表、拼物理地址。TLB 命中只省查页表那一步，页内偏移一直原样搬过去。题目再加 Cache 也先别混进来。",
        "缺页先处理缺页，别硬往下算。",
        "这章我也刚被打了一顿。",
      ],
    },
    {
      title: "子网划分错得很随机",
      body: "借几位会，子网数也会，一算可用地址范围就不是漏广播地址，就是进位进错。十道题能错出五种原因，甚至不好意思归类错题。",
      replies: [
        "别心算，步长一段段列。",
        "我强制写网络地址、第一可用、最后可用、广播地址四行。看起来慢，做几道后反而比在脑子里补快。",
        "先把每次错因真写下来，可能最后就两类，只是你现在觉得很随机。",
      ],
    },
    {
      title: "排序第几趟这种题怎么练啊？",
      body: "复杂度背得挺顺，一给序列问第二趟长啥样我就原地模拟，模拟着还会串算法。尤其快排，跟答案过程不一样我就怀疑人生。",
      replies: [
        "先记每一趟保证了什么，别只背代码。",
        "快排一定先看题目用哪种划分写法。不同写法中间序列真可能不一样，最后有序不代表每一趟都能硬对答案。",
      ],
    },
    {
      title: "中断、异常、系统调用，三张脸我一个都认不清",
      body: "表格背过两次，题里换成键盘、除零、读文件，我还是会犹豫。现在决定不背表了，每个场景自己走一遍，看是谁触发、什么时候处理。",
      replies: [
        "场景题比背表好用。",
        "我先问是不是当前指令主动要服务，再看事件来自 CPU 内还是外。除零、键盘、读文件各拿一个例子，三类就慢慢分开了。",
        "别忘了异常也不全都能回原指令继续，这个我老错。",
        "我先收藏，明天学到这。",
      ],
    },
  ],
  经验复盘: [
    {
      title: "第一次掐表做整套，后面大题直接空着",
      body: "平时单题做着还行，整套一开计时脑子就开始赶。选择题磨太久，最后两道大题只写了开头。分数先不看了，我把每一段花了多久记下来了。",
      replies: [
        "第一次这样太正常了。",
        "先分清空着的是不会还是没时间。我第一次模拟也以为自己大题全废，后来发现前面三道选择题磨掉快半小时。",
        "别明天马上再开一套，先把这套收尸。",
        "我做到最后十五分钟字已经不像字了。",
      ],
    },
    {
      title: "刷两周题分没涨，今天有点破防",
      body: "每天题没少做，流程基本是对答案、看懂解析、翻页。今天重做上周错题，同一个坑又掉进去，才发现我之前那个“看懂了”可能全是假的。",
      replies: [
        "看懂答案真的最会骗人。",
        "我现在看完解析会把它关掉，从头再做一遍。还卡的那一步才是没懂的地方，不然眼睛一路点头，手还是不会。",
        "少刷十道也行，先把重复错的那个坑填了。",
      ],
    },
    {
      title: "蒙对的题到底算不算错题？",
      body: "今天有三道在两个选项里硬猜，居然都对了。分数看着挺好，心里知道不是那么回事。全抄进错题本又嫌厚，想只记我纠结的那个点。",
      replies: [
        "蒙对就是不会，记。",
        "不用抄整题，写题号和当时纠结啥。过几天能把四个选项讲明白就划掉，别让它在错题本里住一辈子。",
      ],
    },
    {
      title: "五点起床学了一周，我先投降",
      body: "早上是多学了一个半小时，代价是下午上课发呆，晚上八点就想睡。总时长一算甚至比原来少。明天恢复七点起，不跟打卡视频较劲了。",
      replies: [
        "欢迎回来，五点局不适合我等凡人。",
        "我也试过，前两天很有成就感，第三天开始靠咖啡续命。后来只看一天有效学习多久，不看几点起。",
        "能稳七点已经很好了。",
      ],
    },
    {
      title: "计网停一周，回来跟新课一样",
      body: "这周赶计组，计网一次没开。今天重做滑动窗口，题干眼熟，手完全不动。以后哪怕只做五道选择也得碰一下，停一周捡起来太痛苦了。",
      replies: [
        "四门轮着掉，我已经习惯了。",
        "先别从第一章重看。拿十道题测一下，忘哪补哪，有时候只是手生，重看全章反而又把两天搭进去。",
        "我给每门设了最长三天不碰，超过就塞几道题。",
        "计网尤其容易有这种‘我见过但我不会’的感觉。",
      ],
    },
    {
      title: "错题本写成第二本王道了，根本不想翻",
      body: "前期仪式感拉满，题干选项解析一个不落，现在厚到翻开就烦。准备从今天开始只记题号、错因和一句提醒，能在书上找到的绝不再抄。",
      replies: [
        "别抄题了，真翻不动。",
        "我只留重复错和完全没思路的。那种看漏一个字、下次一眼能发现的，不值得占半页纸。",
        "第二本王道笑死，但我也是。",
      ],
    },
    {
      title: "连续三天学不进去，歇半天算摆吗？",
      body: "坐图书馆八小时，真正学进去可能两小时，剩下时间一直在切软件。越坐越烦，晚上还因为任务没完继续熬。明天下午想出去走走，回来只做一组题。",
      replies: [
        "先歇，半天真没啥。",
        "给休息设个结束点，再给回来后的第一件事定小一点。别写‘恢复正常进度’，就写做五道题，不然还没回来先被计划吓住。",
        "三天都这样可能是真累了，硬坐也没赚到。",
      ],
    },
    {
      title: "二刷真题分高了，这分能信吗？",
      body: "隔一个月重做同一套，涨了二十多分，但有几道题看到选项就想起答案。开心了五分钟又开始心虚，这次可能更适合看旧错改没改，不适合拿来估分。",
      replies: [
        "能记住答案也说明你复盘过，别全盘否定。",
        "看过程吧。只记得字母的不算，会重新推出来、能说清其他选项为什么错的，还是有东西留下了。估分另外找没做过的。",
        "二刷主要是验旧错，不是模拟。",
        "先开心五分钟没问题哈哈。",
      ],
    },
    {
      title: "最近正确率突然掉，我还以为全忘了",
      body: "连着三天错得离谱，今天把错题分了一下，一半是看漏‘不正确的是’，还有几道算对了选错字母。知识点真不会的反而没那么多，可能最近做题太赶。",
      replies: [
        "我也老漏那个‘不’。",
        "我现在选答案前会重新读一遍题目最后一句，再看草稿对应的是哪个选项。多十秒，总比整道题白算强。",
        "连续错得很怪的时候先停一下，疲劳错和知识错混在一起会越复盘越慌。",
      ],
    },
  ],
} satisfies Record<CommunityTopic, readonly CommunityConversationTemplate[]>;

const topicOrder = ["择校交流", "备考规划", "课程讨论", "经验复盘"] as const;

function usersForSchool(schoolName: string) {
  const matched = PRE_DEFENSE_STUDENTS.filter((student) => student.targetSchool === schoolName);
  return matched.length > 0 ? matched : PRE_DEFENSE_STUDENTS;
}

function renderConversation(
  topic: CommunityTopic,
  variationIndex: number,
  schoolName: string,
) {
  const template = topicContent[topic][variationIndex];
  if (!template) {
    throw new Error(`Missing community demo content for ${topic} variation ${variationIndex}.`);
  }
  const render = (value: string) => value.replaceAll("{school}", schoolName);
  return {
    title: render(template.title),
    body: render(template.body),
    replies: template.replies.map(render),
  };
}

function contentForCircle(topic: CommunityTopic, circleId: string) {
  if (circleId === "circle_all_408") {
    return renderConversation(topic, 0, "目标院校");
  }
  const schoolIndex = PRE_DEFENSE_TARGET_SCHOOLS.findIndex((item) => item.circleId === circleId);
  const school = PRE_DEFENSE_TARGET_SCHOOLS[schoolIndex];
  if (!school) {
    throw new Error(`Unknown community circle ${circleId}.`);
  }
  return renderConversation(topic, schoolIndex + 1, school.schoolName);
}

const schoolPosts: CommunityDemoPost[] = PRE_DEFENSE_TARGET_SCHOOLS.flatMap(
  (school, schoolIndex) => topicOrder.map((topic, topicIndex) => {
    const users = usersForSchool(school.schoolName);
    const author = users[(schoolIndex * 5 + topicIndex) % users.length]!;
    const content = contentForCircle(topic, school.circleId);
    return {
      postId: `community_demo_${school.circleId}_${topicIndex + 1}`,
      circleId: school.circleId,
      authorUserId: author.userId,
      topic,
      title: content.title,
      body: content.body,
      ageHours: 4 + schoolIndex * 11 + topicIndex * 3,
      viewCount: 18 + ((schoolIndex * 17 + topicIndex * 13) % 96),
    };
  }),
);

const generalPosts: CommunityDemoPost[] = topicOrder.map((topic, topicIndex) => {
  const author = PRE_DEFENSE_STUDENTS[40 + topicIndex * 9]!;
  const content = contentForCircle(topic, "circle_all_408");
  return {
    postId: `community_demo_circle_all_408_${topicIndex + 1}`,
    circleId: "circle_all_408",
    authorUserId: author.userId,
    topic,
    title: content.title,
    body: content.body,
    ageHours: 2 + topicIndex * 5,
    viewCount: 74 + topicIndex * 19,
  };
});

export const COMMUNITY_DEMO_POSTS: readonly CommunityDemoPost[] = [
  ...generalPosts,
  ...schoolPosts,
];

export const COMMUNITY_DEMO_REPLIES: readonly CommunityDemoReply[] = COMMUNITY_DEMO_POSTS.flatMap(
  (post, postIndex) => {
    const school = PRE_DEFENSE_TARGET_SCHOOLS.find((item) => item.circleId === post.circleId);
    const candidates = school ? usersForSchool(school.schoolName) : PRE_DEFENSE_STUDENTS;
    const replies = contentForCircle(post.topic, post.circleId).replies;
    return replies.map((body, replyIndex) => ({
      replyId: `${post.postId}_reply_${replyIndex + 1}`,
      postId: post.postId,
      authorUserId: candidates[(postIndex * 3 + replyIndex + 1) % candidates.length]!.userId,
      body,
      ageHours: Math.max(1, post.ageHours - 2 - replyIndex),
    }));
  },
);

export const COMMUNITY_DEMO_LIKES: readonly CommunityDemoLike[] = COMMUNITY_DEMO_POSTS.flatMap(
  (post, postIndex) => Array.from({ length: 3 + (postIndex % 5) }, (_, likeIndex) => ({
    postId: post.postId,
    userId: PRE_DEFENSE_STUDENTS[(postIndex * 7 + likeIndex + 21) % PRE_DEFENSE_STUDENTS.length]!.userId,
  })),
);
