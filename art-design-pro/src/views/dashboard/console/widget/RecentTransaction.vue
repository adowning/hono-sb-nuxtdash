<template>
  <ArtTimelineListCard
    :list="timelineData"
    title="Recent Transactions"
    subtitle="Today's Order Updates"
  />
</template>

<script setup lang="ts">
  interface TimelineItem {
    time: string
    status: string
    content: string
    code?: string
  }

  /**
   * 最近交易时间线数据
   * 记录今日订单处理、商品上架、支付等关键活动
   */
  const timelineData: TimelineItem[] = [
    {
      time: '09:30am',
      status: 'rgb(73, 190, 255)',
      content: 'Receive order #38291 and pay ¥385.90'
    },
    {
      time: '10:00 am',
      status: 'rgb(54, 158, 255)',
      content: 'New product on shelves',
      code: 'SKU-3467'
    },
    {
      time: '12:00 am',
      status: 'rgb(103, 232, 207)',
      content: 'Payment of ¥6495.00 to supplier'
    },
    {
      time: '14:30 PM',
      status: 'rgb(255, 193, 7)',
      content: 'Promotion starts',
      code: 'PROMO-2023'
    },
    {
      time: '15:45 PM',
      status: 'rgb(255, 105, 105)',
      content: 'Order Cancellation Reminder',
      code: 'ORD-9876'
    },
    {
      time: '17:00',
      status: 'rgb(103, 232, 207)',
      content: 'Complete Day Sales Report'
    }
  ]
</script>
