<template>
  <div class="card art-custom-card">
    <div class="card-header">
      <div class="title">
        <h4 class="box-title">Visits</h4>
        <p class="subtitle">growth this year<span class="text-success">+15%</span></p>
      </div>
    </div>
    <ArtLineChart
      class="chart"
      height="calc(100% - 40px)"
      :data="data"
      :xAxisData="xAxisData"
      :showAreaColor="true"
      :showAxisLine="false"
    />
  </div>
</template>

<script setup lang="ts">
  const data = [50, 25, 40, 20, 70, 35, 65, 30, 35, 20, 40, 44]
  const xAxisData = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December'
  ]
</script>

<style lang="scss" scoped>
  .card {
    box-sizing: border-box;
    width: 100%;
    height: 420px;
    padding: 20px 0 30px;

    .card-header {
      padding: 0 18px !important;
    }

    .chart {
      box-sizing: border-box;
      width: 100%;
      padding: 20px 20px 0;
    }
  }

  @media screen and (max-width: $device-phone) {
    .card {
      height: 280px;
    }
  }
</style>
