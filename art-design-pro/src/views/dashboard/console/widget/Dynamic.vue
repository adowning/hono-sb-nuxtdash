<template>
  <div class="card art-custom-card">
    <div class="card-header">
      <div class="title">
        <h4 class="box-title">动态</h4>
        <p class="subtitle">新增<span class="text-success">+6</span></p>
      </div>
    </div>

    <div class="list">
      <div v-for="(item, index) in list" :key="index">
        <span class="user">{{ item.username }}</span>
        <span class="type">{{ item.type }}</span>
        <span class="target">{{ item.target }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  const list = reactive([
    {
      username: 'medium and small fish',
      type: 'Follow',
      target: '簇谇淰'
    },
    {
      username: 'He Xiaohe',
      type: 'Publish an article',
      target: 'Vue3 + Typescript + Vite project practical notes'
    },
    {
      username: '谇谇淰',
      type: 'Ask a question',
      target: 'Can the theme be configured'
    },
    {
      username: 'Daicao',
      type: 'Exchanged items',
      target: '"A Strange Life"'
    },
    {
      username: 'Sweet Cone',
      type: 'Issue closed',
      target: 'daze grass'
    },
    {
      username: 'Leng Yue Dadai',
      type: 'Exchanged items',
      target: '"Seven Habits of Highly Effective People"'
    }
  ])
</script>

<style lang="scss" scoped>
  .card {
    box-sizing: border-box;
    width: 100%;
    height: 510px;
    padding: 0 25px;

    .header {
      display: flex;
      justify-content: space-between;
      padding: 20px 0 0;
    }

    .list {
      height: calc(100% - 100px);
      margin-top: 10px;
      overflow: hidden;

      > div {
        height: 70px;
        overflow: hidden;
        line-height: 70px;
        border-bottom: 1px solid var(--art-border-color);

        span {
          font-size: 13px;
        }

        .user {
          font-weight: 500;
          color: var(--art-text-gray-800);
        }

        .type {
          margin: 0 8px;
        }

        .target {
          color: var(--main-color);
        }
      }
    }
  }
</style>
